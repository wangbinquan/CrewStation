import { afterEach, describe, expect, test } from 'bun:test';
import { ManifestSchema } from '../../../packages/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import { Platform, PlatformError, type Control } from '../src/client';
import { Controller } from '../src/control';
import { migrate } from '../src/migrate';
import { Store } from '../src/store';
import { createHandler } from '../src/main';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 standalone fenced service customer', () => {
  let database: TestDatabase, store: Store;
  afterEach(async () => { await store?.db.close(); await database?.drop(); });
  const fixture = async () => {
    database = await createTestDatabase(); store = new Store(database.url);
    const releaseId = Bun.randomUUIDv7(), calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    let control: Control = { epoch: 1, phase: 'inactive', activeReleaseId: releaseId, physicalSlot: 'blue', leaseOwner: null, leaseExpiresAt: null };
    const taskId = Bun.randomUUIDv7(), subtaskId = Bun.randomUUIDv7();
    const behavior = { denyClaim: false, routeReady: true, unavailable: false, calls: 0 };
    const platform = new Platform('http://platform.invalid', (async (url, options) => {
      const path = new URL(String(url)).pathname, body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ path, body });
      if (behavior.unavailable) return Response.json({ error: 'capacity' }, { status: 429 });
      if (path.endsWith('/capabilities')) return Response.json({ releaseId });
      if (path.endsWith('/control')) return Response.json(control);
      if (path.endsWith('/claim')) {
        if (behavior.denyClaim) return Response.json({ error: 'standby' }, { status: 403 });
        control = { ...control, phase: 'preparing', leaseOwner: String(body.instanceId), leaseId: Bun.randomUUIDv7(), leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() };
      } else if (path.endsWith('/activate')) {
        if (!behavior.routeReady) return Response.json({ error: 'route not observed' }, { status: 412 });
        control = { ...control, phase: 'active' };
      } else if (path.endsWith('/subtasks')) { behavior.calls++; return Response.json({ id: subtaskId, attempt: 1, executionId: subtaskId, state: 'running' }); }
      else if (path.endsWith('/business-tasks') || path.endsWith(`/business-tasks/${taskId}`)) return Response.json({ id: taskId, state: 'running', generation: 1 });
      else if (path.endsWith('/events')) return Response.json({ items: [], hasMore: false, nextCursor: null });
      else if (path.endsWith('/file')) return Response.json({ contentBase64: btoa('preserved'), version: 'fixed' });
      return Response.json(control);
    }) as typeof fetch);
    const controller = new Controller(platform, store), handler = createHandler(store, platform, controller);
    const request = (path: string, body?: unknown, identity = true) => handler(new Request(`http://sample${path}`, { method: body ? 'POST' : 'GET', headers: { ...(identity ? { 'x-cs-user-id': 'test' } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { controller, calls, request, behavior, platform, taskId, subtaskId, getControl: () => control, setControl: (next: Partial<Control>) => { control = { ...control, ...next }; } };
  };
  test('manifest and slow startup are valid; ready does not give a standby writer authority', async () => {
    expect(ManifestSchema.parse(Bun.YAML.parse(await Bun.file(new URL('../crewstation.yaml', import.meta.url)).text())).spec.service.probes?.startup?.failureThreshold).toBe(90);
    const f = await fixture();
    expect((await f.request('/live', undefined, false)).status).toBe(200);
    expect((await f.request('/ready', undefined, false)).status).toBe(503);
    await f.controller.tick(); expect(f.calls).toHaveLength(0);
    await expect(migrate('')).rejects.toThrow('缺少 CS_DATABASE_URL');
    await migrate(database.url); await migrate(database.url);
    f.behavior.denyClaim = true; await f.controller.tick();
    expect((await f.request('/ready', undefined, false)).status).toBe(200);
    expect((await f.request('/actions', { action: 'command', requestKey: 'standby' })).status).toBe(409);
    expect(f.behavior.calls).toBe(0);
    expect((await f.request('/state', undefined, false)).status).toBe(401);
  });
  test('durable keys survive response replay, capacity rejection is not queued and only explicit retry submits', async () => {
    const f = await fixture(); await store.migrate(); await f.controller.tick();
    const input = { action: 'command', requestKey: 'run-1' };
    const first = await (await f.request('/actions', input)).json(); expect(first.task.id).toBe(f.taskId);
    expect(await (await f.request('/actions', { requestKey: 'run-1', action: 'command' })).json()).toEqual(first); expect(f.behavior.calls).toBe(1);
    expect((await f.request('/actions', { ...input, action: 'pause', taskId: f.taskId, expectedGeneration: 1 })).status).toBe(409);
    f.behavior.unavailable = true;
    expect((await f.request('/actions', { action: 'command', requestKey: 'run-2' })).status).toBe(429);
    f.behavior.unavailable = false;
    expect(f.behavior.calls).toBe(1);
    expect((await f.request('/actions', { action: 'command', requestKey: 'run-2' })).status).toBe(200);
    expect(f.behavior.calls).toBe(2);
    expect((await f.request(`/events?taskId=${f.taskId}`)).status).toBe(200);
    expect((await f.request(`/task?taskId=${f.taskId}`)).status).toBe(200);
    expect(await (await f.request(`/proof?taskId=${f.taskId}`)).json()).toMatchObject({ contentBase64: btoa('preserved') });
    expect((await f.request('/actions', {})).status).toBe(400);
  });
  test('new epoch rejects old application transactions; migration permits drain and route delay never activates', async () => {
    const f = await fixture(); await store.migrate(); await f.controller.tick();
    const old = f.controller.fence;
    f.setControl({ epoch: 2, operationId: Bun.randomUUIDv7(), leaseId: undefined });
    f.behavior.routeReady = false; await f.controller.tick();
    expect(() => f.controller.fence).toThrow();
    await expect(store.record('missing', {}, old)).rejects.toThrow('写屏障');
    f.behavior.routeReady = true; await f.controller.tick();
    expect(f.controller.fence.epoch).toBe(2);
    f.setControl({ epoch: 3, phase: 'frozen', migration: { operationId: Bun.randomUUIDv7(), targetReleaseId: Bun.randomUUIDv7(), applicationReady: false } });
    await f.controller.tick(); expect(() => f.controller.fence).toThrow();
    const drain = { requestKey: 'drain', taskId: f.taskId, expectedGeneration: 1 };
    expect((await f.request('/drain', { ...drain, action: 'pause' })).status).toBe(200);
    expect((await f.request('/drain', { ...drain, action: 'cancel', subtaskId: f.subtaskId, expectedAttempt: 1 })).status).toBe(200);
    expect((await f.request('/drain', { ...drain, action: 'resume' })).status).toBe(400);
    expect(f.calls.at(-1)?.body.stopAuthority).toMatchObject({ epoch: 3 });
    await expect(store.prepare(1, old.instanceId, 'active', new Date(Date.now() + 30_000).toISOString())).rejects.toThrow('旧世代');
    f.behavior.unavailable = true; await expect(f.platform.call('/nothing')).rejects.toBeInstanceOf(PlatformError);
  });
});
