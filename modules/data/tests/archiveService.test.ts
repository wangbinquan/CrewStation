import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ArchivePlanDto, ArchivePlanEntriesDto, ProjectId, ServiceId, TaskId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import { archiveService } from '../application/archiveService';
import { archiveServiceRoutes } from '../http/archiveServiceRoutes';
import type { ObjectSource } from '../domain/objectStorage';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-035 archive plan service HTTP and ownership', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture() {
    const f = await objectArchiveFixture(tdb.db);
    const tasks = new Map<string, { serviceId: ServiceId; projectId: ProjectId; completionPolicy: 'legacy' | 'archive-and-delete' }>([[f.taskId, { ...f.source, completionPolicy: 'archive-and-delete' }]]);
    const sources = new Map<string, ObjectSource>([['trusted', f.source], ['dev', { ...f.source, env: 'development' }]]);
    const app = createApp({ name: 'archive-service' });
    const api = archiveService({ catalog: f.catalog, plans: f.plans,
      tasks: { accepted: async () => undefined, read: async (serviceId, taskId) => { const row = tasks.get(taskId); return row?.serviceId === serviceId ? row : undefined; } },
      sources: { resolve: async (caller) => { const source = sources.get(caller.token ?? ''); return caller.identity === 'demo/demo' && source ? { ...source, planId: objectId() } : undefined; } },
    });
    app.route('/', archiveServiceRoutes(api));
    const request = (path: string, body?: unknown, token = 'trusted') => app.request(`/v3/objects${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { [IDENTITY_HEADERS.sourceService]: 'demo/demo', [IDENTITY_HEADERS.sourceToken]: token, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const create = async (key = objectId()) => request(`/tasks/${f.taskId}/archive-plans`, { requestKey: key });
    return { ...f, taskId: f.taskId as TaskId, api, request, create, tasks, sources };
  }
  test('fixed task ownership, production identity and project boundaries are checked before mutation', async () => {
    const f = await fixture(), path = `/tasks/${f.taskId}/archive-plans`, body = { requestKey: 'new' };
    expect((await f.request(path, body, 'fake')).status).toBe(403);
    expect((await f.request(path, body, 'dev')).status).toBe(403);
    expect((await f.request(`/tasks/${objectId()}/archive-plans`, body)).status).toBe(404);
    f.tasks.set(f.taskId, { serviceId: f.source.serviceId, projectId: objectId() as ProjectId, completionPolicy: 'archive-and-delete' });
    expect((await f.request(path, body)).status).toBe(404);
    f.tasks.set(f.taskId, { ...f.source, completionPolicy: 'legacy' });
    expect((await f.request(path, body)).status).toBe(412);
    f.tasks.set(f.taskId, { ...f.source, completionPolicy: 'archive-and-delete' });
    const created = await f.create('stable'); expect(created.status).toBe(201);
    const plan = await created.json() as ArchivePlanDto;
    expect(await (await f.create('stable')).json()).toEqual(plan);
    expect(plan.taskId).toBe(f.taskId as TaskId); expect(plan).not.toHaveProperty('spaceId');
    const other = await fixture(); expect((await other.request(`/archive-plans/${plan.id}`)).status).toBe(404);
    expect((await f.request(`/archive-plans/${plan.id}`, undefined, 'fake')).status).toBe(403);
    expect((await f.request(path, { ...body, serviceId: f.source.serviceId })).status).toBe(400);
  });
  test('finalization preflight rejects unsealed, foreign and stale manifests without binding them', async () => {
    const f = await fixture(), caller = { identity: 'demo/demo', token: 'trusted' };
    const plan = await (await f.create()).json() as ArchivePlanDto;
    await expect(f.api.preflight(caller, f.taskId, { planId: plan.id, planRevision: 1, digest: 'a'.repeat(64) })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.api.preflight(caller, f.taskId, { noArtifactsReason: 'explicitly no files' })).toEqual({ spaceId: f.space.id });
    const root = `/archive-plans/${plan.id}`;
    await f.request(`${root}/pages`, { requestKey: 'page', expectedRevision: 1, page: 0, entries: [{ kind: 'object', objectId: f.object.id, name: 'saved' }] });
    const sealed = await (await f.request(`${root}/seal`, { requestKey: 'seal', expectedRevision: 2 })).json() as ArchivePlanDto;
    const archive = { planId: plan.id, planRevision: sealed.revision, digest: sealed.digest! };
    expect(await f.api.preflight(caller, f.taskId, archive)).toEqual({ spaceId: f.space.id });
    await expect(f.api.preflight(caller, f.taskId, { ...archive, digest: 'b'.repeat(64) })).rejects.toMatchObject({ kind: 'conflict' });
    const other = await fixture();
    await expect(other.api.preflight(caller, other.taskId, archive)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.api.preflight({ ...caller, token: 'fake' }, f.taskId, archive)).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await f.plans.get(plan.id))!.state).toBe('sealed');
  });
  test('paged manifest accepts 32–256 KiB only on its own route, enforces revision and seals pinned objects', async () => {
    const f = await fixture(), plan = await (await f.create()).json() as ArchivePlanDto, root = `/archive-plans/${plan.id}`;
    const entries = Array.from({ length: 100 }, (_, i) => ({ kind: 'file' as const, path: `reports/${'x'.repeat(400)}-${i}`, name: `artifact-${i}` }));
    const page = { requestKey: 'page', expectedRevision: 1, page: 0, entries };
    expect(Buffer.byteLength(JSON.stringify(page))).toBeGreaterThan(32_768);
    expect((await f.request(`${root}/pages`, page)).status).toBe(200);
    expect((await f.request(`${root}/pages`, page)).status).toBe(200);
    expect((await f.request(`${root}/entries?expectedRevision=1&offset=0&limit=50`)).status).toBe(409);
    const first = await (await f.request(`${root}/entries?expectedRevision=2&offset=0&limit=70`)).json() as ArchivePlanEntriesDto;
    const second = await (await f.request(`${root}/entries?expectedRevision=2&offset=${first.nextOffset}&limit=70`)).json() as ArchivePlanEntriesDto;
    expect(first.items).toHaveLength(70); expect(second.items).toHaveLength(30); expect(second.nextOffset).toBeNull();
    expect(new Set([...first.items, ...second.items].map((e) => e.name)).size).toBe(100);
    const append = { requestKey: 'object', expectedRevision: 2, page: 1, entries: [{ kind: 'object', objectId: f.object.id, name: 'already-saved' }] };
    expect((await f.request(`${root}/pages`, append)).status).toBe(200);
    const sealed = await f.request(`${root}/seal`, { requestKey: 'seal', expectedRevision: 3 }); expect(sealed.status).toBe(200);
    expect(await sealed.json()).toMatchObject({ state: 'sealed', itemCount: 101, revision: 4 });
    expect((await f.reads.object(f.object.id))!.referenceCount).toBe(1);
    expect((await f.request(`${root}/pages`, { ...page, requestKey: 'oversize', extra: 'x'.repeat(OBJECT_STORAGE_LIMITS.pageBytes) })).status).toBe(413);
    expect((await f.request(`/tasks/${f.taskId}/archive-plans`, { requestKey: 'ordinary', extra: 'x'.repeat(40_000) })).status).toBe(413);
    expect((await f.request(`${root}/entries?expectedRevision=4&limit=101`)).status).toBe(400);
    expect((await f.request(`${root}/abort`, { requestKey: 'abort', expectedRevision: 4 })).status).toBe(200);
    expect((await f.reads.object(f.object.id))!.referenceCount).toBe(0);
  });
  test('stale service fences and backup freezes block plans without consuming revision or removing references', async () => {
    const f = await fixture(), plan = await (await f.create()).json() as ArchivePlanDto, root = `/archive-plans/${plan.id}`;
    const control = { serviceId: f.source.serviceId, controlVersion: 1, epoch: 2, leaseId: objectId(), instanceId: objectId(), podUid: objectId(), leaseUntil: new Date(Date.now() + 30_000).toISOString(), phase: 'active' as const };
    await f.catalog.applyWriteControl(control);
    f.sources.set('trusted', { ...f.source, fenced: true, podUid: control.podUid! });
    const body = { requestKey: 'page', expectedRevision: 1, page: 0, entries: [{ kind: 'object', objectId: f.object.id, name: 'saved' }] };
    expect((await f.request(`${root}/pages`, body)).status).toBe(412);
    const fence = { epoch: control.epoch, leaseId: control.leaseId, instanceId: control.instanceId };
    expect((await f.request(`${root}/pages`, { ...body, fence })).status).toBe(200);
    await f.catalog.freeze({ id: objectId(), kind: 'backup', backendId: f.backend.id, epoch: 1, active: true });
    expect((await f.request(`${root}/abort`, { requestKey: 'abort', expectedRevision: 2, fence })).status).toBe(412);
    expect((await f.plans.get(plan.id))!.revision).toBe(2); expect((await f.reads.object(f.object.id))!.referenceCount).toBe(1);
  });
});
