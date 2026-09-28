import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ObjectStorageObservationSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { objectCatalogRepository } from '../adapters/persistence/objectCatalog';
import { objectReadRepository } from '../adapters/persistence/objectReads';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { objectAdministration } from '../application/objectAdministration';
import { probeObjectBackends, verifyNextObject } from '../application/objectMaintenance';
import { objectAdminRoutes, objectMetricsExporter } from '../http/objectAdminRoutes';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { dataMigrations } from '../wiring';
import { backendFixture, objectId, sourceFixture } from './objectFixtures';
import { objectBackupRepository } from '../adapters/persistence/objects/backups';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataMigrations]); });
afterAll(async () => { await tdb?.drop(); });
const owner: Actor = { userId: objectId() as UserId, isAdmin: false }, admin: Actor = { userId: objectId() as UserId, isAdmin: true };
async function fixture() {
  const catalog = objectCatalogRepository(tdb.db), uploads = objectUploadRepository(tdb.db), reads = objectReadRepository(tdb.db);
  const backend = await catalog.registerBackend(backendFixture({ health: 'ready', observedAt: new Date().toISOString() })), source = sourceFixture();
  const plan = await catalog.savePlan(objectId(), { name: 'Plan', backendId: backend.id, quotaBytes: 1000, maxObjectBytes: 1000, maxConcurrentTransfers: 4, enabled: true });
  await catalog.authorizePlans(source.projectId, 1, [plan.id]);
  const space = await catalog.ensureSpace({ ...source, id: objectId(), planId: plan.id, deploymentMode: 'local' });
  let probes = 0, verifies = 0;
  const plane = { probe: async (id: string) => { probes++; return { backendId: id, placementRevision: 1, credentialRevision: 1, health: 'ready' as const, message: null, observedAt: new Date(Date.now() + 1).toISOString() }; }, verify: async () => { verifies++; return { size: 100, sha256: 'a'.repeat(64) }; } } as unknown as ObjectBackendPlane;
  const backups = objectBackupRepository(tdb.db);
  const api = objectAdministration({ catalog, reads, plane, backups, authorizer: { authorize: async (actor, projectId) => { if (!actor.isAdmin && (actor.userId !== owner.userId || projectId !== source.projectId)) throw forbidden(); } }, services: { resolveServiceById: async () => ({ projectId: source.projectId, slug: 'observable-service' }) } });
  const app = createApp({ name: 'object-admin-test' }); app.route('/', objectAdminRoutes(api, async (id) => id === admin.userId));
  const request = (path: string, actor?: Actor) => app.request(path, { headers: actor ? { [IDENTITY_HEADERS.userId]: actor.userId } : {} });
  return { catalog, uploads, reads, backend, source, space, plane, api, app, request, backups, calls: () => ({ probes, verifies }) };
}

describe.skipIf(!available)('object administration and observations', () => {
  test('backup details are administrator-only; project views reveal no other-project counts or operational notes', async () => {
    const f = await fixture(), backup = await f.backups.begin({ requestKey: objectId(), destination: 'offsite', reason: 'private operations note' });
    await f.backups.finish(backup.id, { errorCode: 'export_failed' });
    const visible = await f.api.observation(admin, { backendId: f.backend.id }, '1h');
    expect(visible.backup?.latest).toMatchObject({ id: backup.id, state: 'failed', reason: 'private operations note' });
    expect(visible.lastBackupAt).toBeNull();
    const scoped = await f.api.observation(owner, { spaceId: f.space.id }, '1h');
    expect(scoped.backup).toBeNull(); expect(JSON.stringify(scoped)).not.toContain('private operations note');
    expect(f.calls()).toEqual({ probes: 0, verifies: 0 });
  });
  test('console reads require identity, admin backend access and project membership, with 404 for foreign objects', async () => {
    const f = await fixture();
    expect((await f.request('/v3/admin/object-storage/backends')).status).toBe(401);
    expect((await f.request('/v3/admin/object-storage/backends', owner)).status).toBe(403);
    const body = await (await f.request('/v3/admin/object-storage/backends', admin)).json();
    expect(JSON.stringify(body)).not.toContain('requestDigest'); expect(JSON.stringify(body)).not.toContain('accessKey');
    expect(await f.api.spaces(owner, f.source.projectId)).toMatchObject([{ id: f.space.id, serviceSlug: 'observable-service' }]);
    await expect(f.api.spaces(owner, objectId() as ProjectId)).rejects.toThrow('无权');
    const outsider = { userId: objectId() as UserId, isAdmin: false };
    expect((await f.request(`/v3/object-storage/spaces/${f.space.id}/objects`, outsider)).status).toBe(404);
    expect((await f.request(`/v3/object-storage/spaces/${f.space.id}/observation`, outsider)).status).toBe(404);
    expect((await f.request(`/v3/object-storage/spaces/${f.space.id}/observation?window=invalid`, owner)).status).toBe(400);
    expect(f.calls()).toEqual({ probes: 0, verifies: 0 });
  });
  test('unknown writers and logical reservations come from PostgreSQL; observation never runs maintenance', async () => {
    const f = await fixture(), authority = { source: f.source };
    const input = { requestKey: objectId(), name: 'artifact.txt', mediaType: 'text/plain', size: 100, sha256: 'a'.repeat(64) };
    await f.uploads.reserve(f.space.id, objectId(), input, authority);
    const pending = await f.uploads.reserve(f.space.id, objectId(), { ...input, requestKey: objectId() }, authority);
    const attempt = await f.uploads.begin(pending.id, objectId(), objectId(), authority);
    await f.uploads.finish(attempt.attempt, { errorCode: 'response_lost', uncertain: true });
    const response = await f.request(`/v3/object-storage/spaces/${f.space.id}/observation`, owner);
    const data = ObjectStorageObservationSchema.parse(await response.json());
    expect(data.queue).toMatchObject({ uploading: 1, verifying: 0, failed: 1, unknownWrites: 1, pendingBytes: 200 });
    expect(data.queue.oldestPendingAt).not.toBeNull(); expect(data.logical).toMatchObject({ reservedBytes: 200, usedBytes: 0 });
    expect(data.physical.freeBytes).toBeNull(); expect(data.samples).toEqual([]); expect(data.stale).toBe(true);
    expect(f.calls()).toEqual({ probes: 0, verifies: 0 });
  });
  test('periodic health checks do not make old disk observations fresh; verifier publishes only verified objects', async () => {
    const f = await fixture(), authority = { source: f.source };
    const old = '2020-01-01T00:00:00.000Z';
    await f.catalog.observeBackend({ backendId: f.backend.id, placementRevision: 1, credentialRevision: 1, health: 'ready', freeBytes: 10, totalBytes: 100, physicalObservedAt: old, observedAt: new Date(Date.now() + 1).toISOString(), message: null });
    await probeObjectBackends(f.catalog, f.plane, new AbortController().signal);
    const data = await f.api.observation(owner, { spaceId: f.space.id }, '1h');
    expect(data.health).toBe('ready'); expect(data.physical).toEqual({ freeBytes: null, totalBytes: null, observedAt: old });
    const upload = await f.uploads.reserve(f.space.id, objectId(), { requestKey: objectId(), name: 'artifact', mediaType: 'text/plain', size: 1, sha256: 'a'.repeat(64) }, authority);
    const claim = await f.uploads.begin(upload.id, objectId(), objectId(), authority);
    await f.uploads.finish(claim.attempt, { receivedBytes: 1, sha256: 'a'.repeat(64) }); await f.uploads.requestCommit(upload.id, authority);
    const worker = { uploads: f.uploads, plane: { ...f.plane, verify: async () => ({ size: 1, sha256: 'b'.repeat(64) }) }, owner: objectId() };
    expect(await verifyNextObject(worker, new AbortController().signal)).toBe(true);
    expect((await f.uploads.get(upload.id))?.state).toBe('failed'); expect(await f.reads.object(upload.id)).toBeUndefined();
  });
  test('configuration writes validate identity and revisions; project policy reads do not grant or alter access', async () => {
    const f = await fixture(), headers = { [IDENTITY_HEADERS.userId]: admin.userId, 'content-type': 'application/json' };
    const initial = await f.catalog.policy(f.source.projectId), url = `/v3/admin/object-storage/projects/${f.source.projectId}/policy`;
    expect((await f.request(url, owner)).status).toBe(403);
    expect(await (await f.request(url, admin)).json()).toEqual(initial);
    const input = { name: 'edited', state: 'no-new-spaces', expectedRevision: f.backend.revision, budgetBytes: f.backend.budgetBytes };
    const backendUrl = `/v3/admin/object-storage/backends/${f.backend.id}`;
    expect((await f.app.request(backendUrl, { method: 'PUT', headers: { ...headers, [IDENTITY_HEADERS.userId]: owner.userId }, body: JSON.stringify(input) })).status).toBe(403);
    const saved = await f.app.request(backendUrl, { method: 'PUT', headers, body: JSON.stringify(input) }); expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ name: 'edited', revision: 2, state: 'no-new-spaces' });
    expect((await f.app.request(backendUrl, { method: 'PUT', headers, body: JSON.stringify(input) })).status).toBe(409);
    const grant = { projectId: f.source.projectId, expectedRevision: initial.revision, planIds: [] };
    const revoked = await f.app.request('/v3/admin/object-storage/project-plans', { method: 'PUT', headers, body: JSON.stringify(grant) }); expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ planIds: [], revision: initial.revision + 1 });
    expect((await f.catalog.space(f.space.id))?.id).toBe(f.space.id);
    expect((await f.app.request('/v3/admin/object-storage/project-plans', { method: 'PUT', headers, body: JSON.stringify(grant) })).status).toBe(409);
    expect(f.calls()).toEqual({ probes: 0, verifies: 0 });
  });
});

test('object metrics exporter requires its own secret, not a console identity', async () => {
  const app = createApp({ name: 'object-exporter-test' }); app.route('/', objectMetricsExporter(() => 'cs_object_transfer_requests_total 2\n', 'exporter-secret'));
  expect((await app.request('/internal/object-storage/metrics')).status).toBe(401);
  expect((await app.request('/internal/object-storage/metrics', { headers: { [IDENTITY_HEADERS.userId]: admin.userId } })).status).toBe(401);
  const response = await app.request('/internal/object-storage/metrics', { headers: { authorization: 'Bearer exporter-secret' } });
  expect(response.status).toBe(200); expect(await response.text()).toContain('requests_total 2');
});
