// RFC-043 — a paused durable business task is repinned to another validated version of the same runtime image.
// Why these tests exist: AW RFC-370 v4 hosted acceptance (2026-10-19) found durable parents kept their creation image for
// life, so volume commands added by later releases never reached them. They lock admission (fence, paused, persistent,
// release selection), the worker order (same image → reserve → confirm → repin → record → release the replaced pin), replay
// and the already-pinned no-op, failures that keep the original pin, and the readers that follow the current pin.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import type { BusinessCapabilitiesDto, BusinessControlDto, BusinessEventPage, BusinessOperationDto, BusinessTaskV3Dto, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import type { BusinessRuntimeImages } from '../ports/runtimeImages';
import { contracts } from '../adapters/persistence/tables';
import { executionLifecycles } from '../adapters/persistence/execution/lifecycleTables';
import { executionHttpFixture } from './executionHttpFixture';

const available = await testDatabaseAvailable(), control = '/v3/business-execution/control';
describe.skipIf(!available)('RFC-043 business task runtime image upgrade', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(options: { repin?: boolean } = {}) {
    const imageId = newResourceId(), original = newResourceId(), newer = newResourceId(), foreign = newResourceId(), disabled = newResourceId();
    const versions = new Map<string, { imageId: string; state: 'available' | 'disabled' }>([[original, { imageId, state: 'available' }], [newer, { imageId, state: 'available' }], [foreign, { imageId: newResourceId(), state: 'available' }], [disabled, { imageId, state: 'disabled' }]]);
    const tags = new Map([[original, 'a'], [newer, 'b'], [foreign, 'c'], [disabled, 'd']]), calls: string[] = [], refs = new Set<string>();
    const snapshotOf = (versionId: string, source: 'request' | 'configuration'): RuntimeImageExecutionSnapshot => {
      const digest = `sha256:${(tags.get(versionId) ?? 'f').repeat(64)}`;
      return { versionId, image: `registry.test/task@${digest}`, digest, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: digest, validationId: newResourceId(), selectionSource: source };
    };
    const behavior: { reserve?: Error; repin?: Error; stealClaim?: boolean } = {};
    const port: BusinessRuntimeImages = {
      reserveTask: async (_project, taskId, selection, requested) => {
        const versionId = requested ?? selection.runtimeImageVersionId!;
        calls.push(`reserve:${versionId}:${requested ? 'request' : 'configuration'}`);
        if (behavior.reserve) throw behavior.reserve;
        refs.add(`${versionId}:${taskId}`); return snapshotOf(versionId, requested ? 'request' : 'configuration');
      },
      confirmTask: async (image) => { calls.push(`confirm:${image.versionId}`); },
      release: async (image, owner) => { calls.push(`release:${image.versionId}`); refs.delete(`${image.versionId}:${owner.id}`); },
      inspectReference: async (_project, owner, image) => refs.has(`${image.versionId}:${owner.id}`),
      versionImage: async (_project, versionId) => versions.get(versionId),
    };
    const f = await executionHttpFixture(tdb.db, { port, selection: { runtimeImageVersionId: original, allowedRuntimeImageVersionIds: [newer, foreign, disabled] } });
    const instanceId = newResourceId(), lease = await (await f.request(`${control}/claim`, { instanceId })).json() as BusinessControlDto;
    expect((await f.request(`${control}/activate`, { instanceId, expectedEpoch: lease.epoch, leaseId: lease.leaseId, preparationDigest: 'a'.repeat(64) })).status).toBe(200);
    const fence = { instanceId, epoch: lease.epoch, leaseId: lease.leaseId! };
    const created = await f.request('/v3/business-tasks', { requestKey: 'parent', taskContractVersion: 'v1', fence });
    expect(created.status).toBe(201);
    const task = await created.json() as BusinessTaskV3Dto, env = f.environments.get(task.id)!;
    env.state = 'running'; env.connected = true;
    f.environmentPort.pauseEnvironment = async () => { env.state = 'paused'; env.connected = false; return env; };
    f.environmentPort.resumeEnvironment = async () => { env.state = 'creating'; return env; };
    f.environmentPort.releaseEnvironment = async () => { env.state = 'released'; env.connected = false; return env; };
    if (options.repin !== false) f.environmentPort.repinPausedBusinessWorkspace = async (input) => {
      calls.push(`repin:${input.runtimeImage.versionId}:${input.generation}`);
      if (behavior.stealClaim) {
        behavior.stealClaim = false;
        await tdb.db.update(executionLifecycles).set({ owner: 'another-worker' }).where(and(eq(executionLifecycles.taskId, task.id), eq(executionLifecycles.action, 'upgrade-runtime-image'), eq(executionLifecycles.id, input.operationId)));
      }
      if (behavior.repin) throw behavior.repin;
      expect(env.state).toBe('paused'); env.image = input.runtimeImage.image; return env;
    };
    const root = `/v3/business-tasks/${task.id}`;
    const view = async () => await (await f.request(root)).json() as BusinessTaskV3Dto;
    const upgrade = async (body: Record<string, unknown>) => f.request(`${root}/runtime-image`, { requestKey: newResourceId(), fence, ...body });
    const pause = async () => { const r = await f.request(`${root}/pause`, { requestKey: 'pause', expectedGeneration: 1, fence }); expect(await r.json()).toMatchObject({ state: 'succeeded' }); };
    calls.length = 0;
    return { ...f, task, env, fence, root, view, upgrade, pause, calls, refs, behavior, snapshotOf, versions: { original, newer, foreign, disabled } };
  }

  test('a paused task is repinned in order, replays as one operation and later resumes on the new image', async () => {
    const f = await fixture();
    expect(await (await f.upgrade({ expectedGeneration: 1, runtimeImageVersionId: f.versions.newer })).json()).toMatchObject({ details: { code: 'task_not_paused' } });
    await f.pause();
    const body = { requestKey: 'upgrade', expectedGeneration: 2, runtimeImageVersionId: f.versions.newer };
    const response = await f.upgrade(body); expect(response.status).toBe(202);
    const operation = await response.json() as BusinessOperationDto;
    expect(operation).toMatchObject({ state: 'succeeded', taskId: f.task.id });
    expect(f.calls).toEqual([`reserve:${f.versions.newer}:request`, `confirm:${f.versions.newer}`, `repin:${f.versions.newer}:3`, `release:${f.versions.original}`]);
    const upgraded = await f.view();
    expect(upgraded).toMatchObject({ state: 'paused', generation: 3, volumeUid: f.task.volumeUid, image: f.snapshotOf(f.versions.newer, 'request').image, runtimeImage: { versionId: f.versions.newer, selectionSource: 'request' } });
    expect([...f.refs]).toEqual([`${f.versions.newer}:${f.task.id}`]);
    // RIU-06: the owner proof follows the pin; the replaced version is no longer this task's.
    expect(await f.module.api.imageReferenceState({ projectId: f.projectId, versionId: f.versions.newer, ownerType: 'task', ownerId: f.task.id })).toBe('active');
    expect(await f.module.api.imageReferenceState({ projectId: f.projectId, versionId: f.versions.original, ownerType: 'task', ownerId: f.task.id })).toBe('unknown');
    // RIU-04: the same key returns the same operation without any new effect; a changed target under it is a conflict.
    const replay = await f.make().request(`${f.root}/runtime-image`, { ...body, fence: f.fence });
    expect(await replay.json()).toMatchObject({ operationId: operation.operationId, state: 'succeeded' }); expect(f.calls).toHaveLength(4);
    expect(await (await f.upgrade({ ...body, runtimeImageVersionId: f.versions.original })).json()).toMatchObject({ details: { code: 'idempotency_conflict' } });
    // The target already pinned completes at once and keeps the generation.
    const pinned = await (await f.upgrade({ expectedGeneration: 3, runtimeImageVersionId: f.versions.newer })).json() as BusinessOperationDto;
    expect(pinned.state).toBe('succeeded'); expect(pinned.operationId).not.toBe(operation.operationId);
    expect(await f.view()).toMatchObject({ generation: 3, state: 'paused' }); expect(f.calls).toHaveLength(4);
    const events = await (await f.request(`${f.root}/events`)).json() as BusinessEventPage;
    expect(events.items.filter((event) => event.type === 'task-state').map((event) => event.data)).toContainEqual({ state: 'paused', generation: 3 });
    const resumed = await (await f.request(`${f.root}/resume`, { requestKey: 'resume', expectedGeneration: 3, fence: f.fence })).json() as BusinessOperationDto;
    f.env.state = 'running'; f.env.connected = true;
    for (let i = 0; i < 8; i++) await f.make().module.api.v3.runOnce();
    expect(await (await f.request(`${f.root}/operations/${resumed.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect(await f.view()).toMatchObject({ state: 'running', generation: 4, runtimeImage: { versionId: f.versions.newer } });
  });

  test('without a target the caller release default is used; capabilities report it beside the upgrade flag', async () => {
    const f = await fixture();
    expect(await (await f.request('/v3/business-execution/capabilities')).json()).toMatchObject({ runtimeImageUpgrade: 1, taskRuntimeImageVersionId: f.versions.original });
    await tdb.db.update(contracts).set({ tasksSpec: sql`tasks_spec || ${JSON.stringify({ runtimeImageVersionId: f.versions.newer })}::jsonb` }).where(eq(contracts.releaseId, f.releaseId));
    expect(await (await f.request('/v3/business-execution/capabilities')).json()).toMatchObject({ taskRuntimeImageVersionId: f.versions.newer });
    await f.pause();
    expect(await (await f.upgrade({ expectedGeneration: 2 })).json()).toMatchObject({ state: 'succeeded' });
    expect(f.calls[0]).toBe(`reserve:${f.versions.newer}:configuration`);
    expect(await f.view()).toMatchObject({ generation: 3, runtimeImage: { versionId: f.versions.newer, selectionSource: 'configuration' } });
    const without = await fixture({ repin: false });
    const capabilities = await (await without.request('/v3/business-execution/capabilities')).json() as BusinessCapabilitiesDto;
    expect(capabilities.runtimeImageUpgrade).toBeUndefined(); expect(capabilities.taskRuntimeImageVersionId).toBeUndefined();
    await without.pause();
    expect(await (await without.upgrade({ expectedGeneration: 2, runtimeImageVersionId: without.versions.newer })).json()).toMatchObject({ state: 'failed', message: 'unsupported_capability' });
    expect(await without.view()).toMatchObject({ state: 'paused', runtimeImage: { versionId: without.versions.original } });
  });

  test('admission rejects a missing or stale fence, a version outside the release selection and a stale generation', async () => {
    const f = await fixture(); await f.pause();
    const missing = await f.request(`${f.root}/runtime-image`, { requestKey: newResourceId(), expectedGeneration: 2, runtimeImageVersionId: f.versions.newer });
    expect(missing.status).toBe(400);
    expect((await f.upgrade({ expectedGeneration: 2, fence: { ...f.fence, leaseId: newResourceId() }, runtimeImageVersionId: f.versions.newer })).status).toBe(409);
    const outside = await f.upgrade({ expectedGeneration: 2, runtimeImageVersionId: newResourceId() });
    expect(outside.status).toBe(400); expect(await outside.json()).toMatchObject({ details: { code: 'runtime_image_not_allowed' } });
    const stale = await f.upgrade({ expectedGeneration: 1, runtimeImageVersionId: f.versions.newer });
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ details: { code: 'stale_generation' } });
    expect(f.calls).toEqual([]); expect(await f.view()).toMatchObject({ generation: 2, runtimeImage: { versionId: f.versions.original } });
  });

  test('another image, an unavailable version or an unvalidated usage fails the operation and keeps the original pin', async () => {
    const f = await fixture(); await f.pause();
    expect(await (await f.upgrade({ expectedGeneration: 2, runtimeImageVersionId: f.versions.foreign })).json()).toMatchObject({ state: 'failed', message: 'runtime_image_mismatch' });
    expect(await (await f.upgrade({ expectedGeneration: 3, runtimeImageVersionId: f.versions.disabled })).json()).toMatchObject({ state: 'failed', message: 'image_unavailable' });
    expect(f.calls).toEqual([]);
    f.behavior.reserve = precondition('该镜像尚未通过所选用途与档位的验证', { code: 'image_usage_unvalidated' });
    expect(await (await f.upgrade({ expectedGeneration: 4, runtimeImageVersionId: f.versions.newer })).json()).toMatchObject({ state: 'failed', message: 'image_usage_unvalidated' });
    expect(f.calls).toEqual([`reserve:${f.versions.newer}:request`]);
    expect(await f.view()).toMatchObject({ state: 'paused', generation: 5, runtimeImage: { versionId: f.versions.original } });
    expect([...f.refs]).toEqual([`${f.versions.original}:${f.task.id}`]);
  });

  test('an explicit repin rejection releases the new reference; an unknown one blocks resume until replay completes', async () => {
    const f = await fixture(); await f.pause();
    f.behavior.repin = precondition('只有已暂停的业务工作区可以升级运行镜像', { code: 'task_not_paused' });
    expect(await (await f.upgrade({ expectedGeneration: 2, runtimeImageVersionId: f.versions.newer })).json()).toMatchObject({ state: 'failed', message: 'task_not_paused' });
    expect(f.calls).toEqual([`reserve:${f.versions.newer}:request`, `confirm:${f.versions.newer}`, `repin:${f.versions.newer}:3`, `release:${f.versions.newer}`]);
    expect([...f.refs]).toEqual([`${f.versions.original}:${f.task.id}`]);
    expect(await f.view()).toMatchObject({ state: 'paused', generation: 3, runtimeImage: { versionId: f.versions.original } });
    f.calls.length = 0; f.behavior.repin = new Error('reply lost');
    const unknown = await (await f.upgrade({ expectedGeneration: 3, runtimeImageVersionId: f.versions.newer })).json() as BusinessOperationDto;
    expect(unknown).toMatchObject({ state: 'pending', message: 'lifecycle_unknown' });
    // RIU-04: an in-flight upgrade excludes resume and close.
    expect((await f.request(`${f.root}/resume`, { requestKey: 'resume', expectedGeneration: 4, fence: f.fence })).status).toBe(409);
    expect((await f.request(`${f.root}/close`, { requestKey: 'close', expectedGeneration: 4, fence: f.fence })).status).toBe(409);
    f.behavior.repin = undefined;
    for (let i = 0; i < 8; i++) await f.make().module.api.v3.runOnce();
    expect(await (await f.request(`${f.root}/operations/${unknown.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect(f.calls.filter((call) => call.startsWith('release:'))).toEqual([`release:${f.versions.original}`]);
    expect(await f.view()).toMatchObject({ state: 'paused', generation: 4, runtimeImage: { versionId: f.versions.newer } });
  });

  test('a worker that lost its claim leaves recording to the next owner, which replays reservation and repin', async () => {
    const f = await fixture(); await f.pause(); f.behavior.stealClaim = true;
    const lost = await (await f.upgrade({ expectedGeneration: 2, runtimeImageVersionId: f.versions.newer })).json() as BusinessOperationDto;
    expect(lost.state).toBe('running');
    expect(await f.view()).toMatchObject({ state: 'paused', runtimeImage: { versionId: f.versions.original } });
    await tdb.db.update(executionLifecycles).set({ leaseUntil: sql`now() - interval '1 second'` }).where(eq(executionLifecycles.id, lost.operationId));
    for (let i = 0; i < 8; i++) await f.make().module.api.v3.runOnce();
    expect(await (await f.request(`${f.root}/operations/${lost.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect(f.calls.filter((call) => call.startsWith('repin:'))).toEqual([`repin:${f.versions.newer}:3`, `repin:${f.versions.newer}:3`]);
    expect(f.calls.at(-1)).toBe(`release:${f.versions.original}`);
    expect(await f.view()).toMatchObject({ runtimeImage: { versionId: f.versions.newer } });
  });

  test('concurrent upgrades admit one; closing an upgraded task releases its current and admitted references', async () => {
    const f = await fixture(); await f.pause();
    const responses = await Promise.all([f.upgrade({ expectedGeneration: 2, runtimeImageVersionId: f.versions.newer }), f.make().request(`${f.root}/runtime-image`, { requestKey: newResourceId(), expectedGeneration: 2, fence: f.fence, runtimeImageVersionId: f.versions.newer })]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(f.calls.filter((call) => call.startsWith('repin:'))).toHaveLength(1);
    f.calls.length = 0;
    expect(await (await f.request(`${f.root}/close`, { requestKey: 'close', expectedGeneration: 3, fence: f.fence })).json()).toMatchObject({ state: 'succeeded' });
    expect(f.calls.sort()).toEqual([`release:${f.versions.newer}`, `release:${f.versions.original}`].sort());
    expect(f.refs.size).toBe(0);
    expect(await f.module.api.imageReferenceState({ projectId: f.projectId, versionId: f.versions.newer, ownerType: 'task', ownerId: f.task.id })).toBe('released');
  });
});
