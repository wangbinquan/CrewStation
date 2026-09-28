import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { s3ObjectPlane } from '../../data-control/adapters/http/s3Objects';
import { garageAvailable, startGarage } from '../../data-control/tests/garageFixture';
import { objectCatalogRepository } from '../adapters/persistence/objectCatalog';
import { objectContentRepository } from '../adapters/persistence/objectContent';
import { objectReadRepository } from '../adapters/persistence/objectReads';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { verifyNextObject } from '../application/objectMaintenance';
import { objectRecoveryRepository } from '../adapters/persistence/objects/recovery';
import { recoverObjectTransfers } from '../application/objects/recovery';
import { objectService } from '../application/objectService';
import { objectServiceRoutes } from '../http/objectServiceRoutes';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { dataMigrations } from '../wiring';
import { backendFixture, objectId, sourceFixture } from './objectFixtures';

const databaseAvailable = await testDatabaseAvailable(), available = databaseAvailable && garageAvailable;
let tdb: TestDatabase, garage: Awaited<ReturnType<typeof startGarage>>;
beforeAll(async () => { if (available) { tdb = await createTestDatabase([dataMigrations]); garage = await startGarage(); } }, 90_000);
afterAll(async () => { await garage?.dispose(); await tdb?.drop(); }, 30_000);
async function fixture() {
  const catalog = objectCatalogRepository(tdb.db), content = objectContentRepository(tdb.db), uploads = objectUploadRepository(tdb.db), reads = objectReadRepository(tdb.db);
  const source = sourceFixture(), backend = await catalog.registerBackend(backendFixture({ health: 'ready', observedAt: new Date().toISOString() }));
  const plan = await catalog.savePlan(objectId(), { name: 'Garage', backendId: backend.id, quotaBytes: 4000, maxObjectBytes: 1000, maxConcurrentTransfers: 4, enabled: true });
  await catalog.authorizePlans(source.projectId, 1, [plan.id]);
  const space = await catalog.ensureSpace({ ...source, id: objectId(), planId: plan.id, deploymentMode: 'local' });
  await catalog.ensureSpace({ ...source, env: 'development', id: objectId(), planId: plan.id, deploymentMode: 'local' });
  const plane = { ...s3ObjectPlane({ endpoint: async () => garage.config }), metrics: () => '' } as ObjectBackendPlane;
  const deps = { catalog, content, uploads, reads, plane, owner: objectId(), sources: { resolve: async (caller: { token?: string; identity: string }) => caller.identity !== 'sample/sample' ? undefined : caller.token === 'production-pod' ? { ...source, planId: plan.id } : caller.token === 'development-pod' ? { ...source, env: 'development' as const, planId: plan.id } : undefined } };
  const app = createApp({ name: 'object-service-integration' }); app.route('/', objectServiceRoutes(objectService(deps)));
  const request = (path: string, method = 'GET', body?: string, token = 'production-pod', raw = false) => app.request(`/v3/objects${path}`, { method, headers: { [IDENTITY_HEADERS.sourceService]: 'sample/sample', [IDENTITY_HEADERS.sourceToken]: token, ...(body !== undefined ? { 'content-type': raw ? 'application/octet-stream' : 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}) }, ...(body !== undefined ? { body } : {}) });
  const upload = async (bytes: string, name = '报告.txt') => {
    const response = await request('/uploads', 'POST', JSON.stringify({ requestKey: objectId(), name, size: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }));
    expect(response.status).toBe(201); return (await response.json() as { id: string }).id;
  };
  return { ...deps, app, source, backend, space, request, upload };
}

describe.skipIf(!available)('service HTTP → PostgreSQL → real Garage', () => {
  test('PUT response loss is recovered from the unique committed key, never from 404', async () => {
    const f = await fixture(), bytes = 'response-lost', id = await f.upload(bytes);
    const claim = await f.uploads.begin(id, objectId(), objectId(), { source: f.source });
    expect(await f.plane.inspectWrite!(claim.attempt, new AbortController().signal)).toBe('unknown');
    await f.plane.put(claim.attempt, { body: new Blob([bytes]).stream(), size: bytes.length, sha256: claim.upload.sha256, signal: new AbortController().signal });
    await f.uploads.finish(claim.attempt, { errorCode: 'lost_response', uncertain: true });
    await f.request(`/uploads/${id}/commit`, 'POST', JSON.stringify({ requestKey: objectId() }));
    await recoverObjectTransfers({ ...f, recovery: objectRecoveryRepository(tdb.db) }, new AbortController().signal);
    expect((await f.uploads.get(id))?.state).toBe('verifying');
    expect(await verifyNextObject(f, new AbortController().signal)).toBe(true);
    expect(await (await f.request(`/${id}/content`)).text()).toBe(bytes);
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(0);
  });
  test('two service instances use the same immutable object after read-back; content is private and safe to download', async () => {
    const f = await fixture(), bytes = '持久化的工作产物\n', id = await f.upload(bytes);
    expect((await f.request(`/uploads/${id}/content`, 'PUT', bytes, 'production-pod', true)).status).toBe(202);
    expect((await f.request(`/${id}/content`)).status).toBe(404);
    expect((await f.request(`/uploads/${id}/commit`, 'POST', JSON.stringify({ requestKey: objectId() }))).status).toBe(202);
    expect(await verifyNextObject(f, new AbortController().signal)).toBe(true);
    const response = await f.request(`/${id}/content`);
    expect(response.status).toBe(200); expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff'); expect(await response.text()).toBe(bytes);
    const another = objectService({ ...f, owner: objectId() });
    expect(await another.get({ identity: 'sample/sample', token: 'production-pod' }, id)).toMatchObject({ id, state: 'ready' });
    expect((await f.catalog.space(f.space.id))?.activeTransfers).toBe(0);
    expect((await f.request(`/${id}/content`, 'GET', undefined, 'development-pod')).status).toBe(404);
    expect((await f.request(`/uploads/${id}`, 'GET', undefined, 'invalid-pod')).status).toBe(403);
    const metadata = JSON.stringify(await (await f.request(`/${id}`)).json());
    expect(metadata).not.toContain('attempts/'); expect(metadata).not.toContain(garage.config.secretAccessKey);
  });
  test('wrong bodies never publish; raw upload and JSON metadata have separate limits', async () => {
    const f = await fixture(), id = await f.upload('valid');
    expect((await f.request(`/uploads/${id}/content`, 'PUT', 'larger', 'production-pod', true)).status).toBe(400);
    const result = await f.request(`/uploads/${id}/content`, 'PUT', 'wrong', 'production-pod', true);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect((await f.uploads.get(id))?.objectId).toBeNull();
    expect((await f.catalog.space(f.space.id))?.reservedBytes).toBe(5);
    expect((await f.request('/uploads', 'POST', JSON.stringify({ extra: 'x'.repeat(40_000) }))).status).toBe(413);
    expect((await f.request('/uploads', 'POST', JSON.stringify({ requestKey: objectId(), name: 'bad', size: 0, sha256: 'a'.repeat(64), serviceId: objectId() }))).status).toBe(400);
  });
  test('external content loss becomes degraded, retains quota and references, and never creates an empty replacement', async () => {
    const f = await fixture(), id = await f.upload('valuable');
    await f.request(`/uploads/${id}/content`, 'PUT', 'valuable', 'production-pod', true);
    await f.request(`/uploads/${id}/commit`, 'POST', JSON.stringify({ requestKey: objectId() }));
    await verifyNextObject(f, new AbortController().signal);
    await f.request(`/${id}/references`, 'PUT', JSON.stringify({ requestKey: objectId(), ownerType: 'application', ownerId: 'report-v1', revision: 1 }));
    const object = (await f.reads.object(id))!;
    await f.plane.remove(object, new AbortController().signal);
    expect((await f.request(`/${id}/content`)).status).toBe(412);
    expect(await f.reads.object(id)).toMatchObject({ state: 'degraded', referenceCount: 1 });
    await f.catalog.observeBackend({ backendId: f.backend.id, placementRevision: 1, credentialRevision: 1, health: 'ready', freeBytes: null, totalBytes: null, observedAt: new Date(Date.now() + 1).toISOString(), message: null });
    expect(await f.catalog.space(f.space.id)).toMatchObject({ health: 'degraded', usedBytes: 8, objectCount: 1, activeTransfers: 0 });
  });
});
