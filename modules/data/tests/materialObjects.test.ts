import { objectService } from '../application/objectService';
import { objectReadRepository } from '../adapters/persistence/objectReads';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createApp } from '@crewstation/http';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { dataMigrations } from '../wiring';
import { objectCatalogRepository } from '../adapters/persistence/objectCatalog';
import { objectContentRepository } from '../adapters/persistence/objectContent';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { materialObjectRepository } from '../adapters/persistence/objects/materials';
import { storageContractRepository } from '../adapters/persistence/objects/contract';
import { materialObjectUseCases } from '../application/objects/materials';
import { materialObjectRoutes } from '../http/materialObjectRoutes';
import { backendFixture, objectId, sourceFixture } from './objectFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-040 material pins and scoped downloads', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); await storageContractRepository(tdb.db).enable(); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture() {
    const catalog = objectCatalogRepository(tdb.db), uploads = objectUploadRepository(tdb.db), content = objectContentRepository(tdb.db);
    const backend = await catalog.registerBackend(backendFixture({ health: 'ready', observedAt: new Date().toISOString() })), source = sourceFixture();
    const plan = await catalog.savePlan(objectId(), { name: 'Materials', backendId: backend.id, quotaBytes: 1000, maxObjectBytes: 1000, maxConcurrentTransfers: 4, enabled: true });
    await catalog.authorizePlans(source.projectId, 1, [plan.id]);
    const space = await catalog.ensureSpace({ ...source, id: objectId(), planId: plan.id, deploymentMode: 'local' }), authority = { source };
    const bytes = new Uint8Array([0, 255, 100]), sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const upload = await uploads.reserve(space.id, objectId(), { requestKey: objectId(), name: 'binary', mediaType: 'application/octet-stream', size: bytes.length, sha256 }, authority);
    const claim = await uploads.begin(upload.id, objectId(), objectId(), authority);
    await uploads.finish(claim.attempt, { receivedBytes: bytes.length, sha256 }); await uploads.requestCommit(upload.id, authority);
    const verify = (await uploads.claimVerification(objectId()))!, object = (await uploads.verified(verify.attempt, { size: bytes.length, sha256 }))!;
    const input = { projectId: source.projectId, serviceId: source.serviceId, materialId: objectId(), objects: [{ objectId: object.id, sha256, size: bytes.length }] };
    const unused = async (): Promise<never> => { throw new Error('unexpected byte operation'); };
    const plane: ObjectBackendPlane = { configure: unused, probe: unused, metrics: () => '', put: unused, verify: unused, remove: unused, get: async () => ({ body: new Blob([bytes]).stream(), size: bytes.length, completed: Promise.resolve({ size: bytes.length, sha256 }) }) };
    let now = Date.now();
    const make = () => materialObjectUseCases({ materials: materialObjectRepository(tdb.db), sources: { resolve: async (caller) => caller.token === 'trusted' ? { ...source, planId: plan.id } : undefined }, content, plane, owner: objectId(), apiUrl: 'http://platform.test', secretKeyBase64: Buffer.alloc(32, 40).toString('base64'), now: () => now });
    const business = objectService({ catalog, uploads, reads: objectReadRepository(tdb.db), content, plane, owner: objectId(), sources: { resolve: async () => ({ ...source, planId: plan.id }) } });
    return { input, object, content, authority, make, business, bytes, reads: objectReadRepository(tdb.db), advance: () => { now += 31 * 60_000; } };
  }
  test('concurrent and cold pin replay retain one protected reference before issuing any grant', async () => {
    const f = await fixture(); await expect(f.make().grants(f.input)).rejects.toThrow('固定');
    await Promise.all([f.make().pin({ identity: 'service', token: 'trusted' }, f.input), f.make().pin({ identity: 'service', token: 'trusted' }, f.input)]);
    await f.make().check(f.input);
    for (const state of ['active', 'released'] as const) await expect(f.business.reference({ identity: 'service', token: 'trusted' }, f.object.id, { requestKey: objectId(), ownerType: 'material-version', ownerId: `cs-execution-material:${f.input.materialId}`, revision: 1 }, state)).rejects.toThrow('平台执行材料引用');
    const grants = await f.make().grants(f.input); expect(grants).toHaveLength(1);
    await expect(f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 2 }, f.authority)).rejects.toThrow('引用');
    const app = createApp({ name: 'material-test' }); app.route('/', materialObjectRoutes(f.make()));
    expect((await app.request(`/internal/material-objects/${f.object.id}`)).status).toBe(403);
    const response = await app.request(`/internal/material-objects/${f.object.id}`, { headers: { authorization: `Bearer ${grants[0]!.token}` } });
    expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(f.bytes);
    const wrong = await app.request(`/internal/material-objects/${objectId()}`, { headers: { authorization: `Bearer ${grants[0]!.token}` } }); expect(wrong.status).toBe(403);
    f.advance(); await expect(f.make().download(f.object.id, grants[0]!.token, new AbortController().signal)).rejects.toThrow('到期');
    expect((await f.make().grants(f.input))[0]!.token).not.toBe(grants[0]!.token);
  });
  // RFC-040 V12: material-version pins were never released, so every execution added permanent
  // references and the business owner could never delete those objects again.
  test('a released pin revision frees the objects; the same revision cannot be re-pinned but a revived revision can', async () => {
    const f = await fixture(), caller = { identity: 'service', token: 'trusted' };
    await f.make().pin(caller, f.input); await f.make().check(f.input);
    await f.make().release({ ...f.input, revision: 1 }); await f.make().release({ ...f.input, revision: 1 });
    await expect(f.make().check(f.input)).rejects.toMatchObject({ details: { code: 'material_objects_released' } });
    await expect(f.make().grants(f.input)).rejects.toThrow('释放');
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(0);
    await expect(f.make().pin(caller, f.input)).rejects.toThrow('释放');
    await f.make().pin(caller, { ...f.input, revision: 2 }); await f.make().check(f.input);
    await expect(f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: (await f.reads.object(f.object.id))!.revision }, f.authority)).rejects.toThrow('引用');
    await f.make().release({ ...f.input, revision: 2 });
    const released = (await f.reads.object(f.object.id))!;
    expect(released.referenceCount).toBe(0);
    expect((await f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: released.revision }, f.authority)).state).toBe('deleting');
    // A release for a material whose objects are gone (or another service) is a no-op, never a stuck error.
    await f.make().release({ ...f.input, serviceId: objectId() as typeof f.input.serviceId, revision: 3 });
    await f.make().release({ ...f.input, objects: [{ ...f.input.objects[0]!, objectId: objectId() }], revision: 3 });
  });
  test('source, project, service and exact metadata are required before any pin or transfer', async () => {
    const f = await fixture();
    await expect(f.make().pin({ identity: 'service' }, f.input)).rejects.toThrow('来源');
    await expect(f.make().pin({ identity: 'service', token: 'trusted' }, { ...f.input, projectId: objectId() as typeof f.input.projectId })).rejects.toThrow('身份');
    await expect(f.make().pin({ identity: 'service', token: 'trusted' }, { ...f.input, objects: [{ ...f.input.objects[0]!, size: 4 }] })).rejects.toThrow('不一致');
    await expect(f.make().check(f.input)).rejects.toThrow('固定');
    await expect(f.make().download(f.object.id, 'broken.private.token', new AbortController().signal)).rejects.toThrow('授权');
  });
});
