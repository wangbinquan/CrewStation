import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { objectCatalogRepository } from '../adapters/persistence/objectCatalog';
import { objectContentRepository } from '../adapters/persistence/objectContent';
import { objectUploadRepository } from '../adapters/persistence/objectUploads';
import { dataMigrations } from '../wiring';
import { backendFixture, objectId, sourceFixture } from './objectFixtures';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataMigrations]); });
afterAll(async () => { await tdb?.drop(); });
async function fixture() {
  const catalog = objectCatalogRepository(tdb.db), uploads = objectUploadRepository(tdb.db), content = objectContentRepository(tdb.db);
  const backend = await catalog.registerBackend(backendFixture({ health: 'ready', observedAt: new Date().toISOString() })), source = sourceFixture();
  const plan = await catalog.savePlan(objectId(), { name: 'Test', backendId: backend.id, quotaBytes: 1000, maxObjectBytes: 1000, maxConcurrentTransfers: 4, enabled: true });
  await catalog.authorizePlans(source.projectId, 1, [plan.id]);
  const space = await catalog.ensureSpace({ ...source, id: objectId(), planId: plan.id, deploymentMode: 'local' }), authority = { source };
  const input = { requestKey: objectId(), name: 'artifact', mediaType: 'text/plain', size: 100, sha256: 'a'.repeat(64) };
  const upload = await uploads.reserve(space.id, objectId(), input, authority), claim = await uploads.begin(upload.id, objectId(), objectId(), authority);
  await uploads.finish(claim.attempt, { receivedBytes: 100, sha256: input.sha256 }); await uploads.requestCommit(upload.id, authority);
  const verification = (await uploads.claimVerification(objectId()))!;
  const object = (await uploads.verified(verification.attempt, { size: 100, sha256: input.sha256 }))!;
  return { catalog, uploads, content, backend, source, space, authority, object };
}
const reference = () => ({ requestKey: objectId(), ownerType: 'application' as const, ownerId: 'report', revision: 1 });
describe.skipIf(!available)('object references, reads and deletion with PostgreSQL', () => {
  test('concurrent pin and delete have one winner, and referenced content cannot be collected', async () => {
    const f = await fixture(), ref = reference();
    const results = await Promise.allSettled([
      f.content.reference(f.object.id, ref, 'active', f.authority),
      f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 1 }, f.authority),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    if (results[0]!.status === 'fulfilled') {
      expect(results[0]!.value.referenceCount).toBe(1);
      await expect(f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 2 }, f.authority)).rejects.toThrow('引用');
    } else await expect(f.content.reference(f.object.id, reference(), 'active', f.authority)).rejects.toThrow('不可读取');
  });
  test('released references retain tombstones; late retry cannot resurrect a version', async () => {
    const f = await fixture(), ref = reference();
    await f.content.reference(f.object.id, ref, 'active', f.authority);
    expect((await f.content.reference(f.object.id, { ...ref, requestKey: objectId() }, 'released', f.authority)).referenceCount).toBe(0);
    expect((await f.content.reference(f.object.id, ref, 'active', f.authority)).referenceCount).toBe(0);
    await expect(f.content.reference(f.object.id, { ...ref, requestKey: objectId() }, 'active', f.authority)).rejects.toThrow('已经释放');
    await expect(f.content.reference(f.object.id, { ...ref, ownerId: 'other' }, 'active', f.authority)).rejects.toThrow('幂等键');
    await expect(f.content.reference(f.object.id, reference(), 'active', { source: sourceFixture() })).rejects.toThrow('不存在');
  });
  test('downloads hold collection until their actual completion; no premature logical or physical refund', async () => {
    const f = await fixture(), owner = objectId(), reader = await f.content.acquireRead(f.object.id, objectId(), owner, f.source);
    const input = { requestKey: objectId(), expectedRevision: 1 };
    const deleted = await f.content.delete(f.object.id, input, f.authority);
    expect(deleted.state).toBe('deleting'); expect((await f.content.delete(f.object.id, input, f.authority)).revision).toBe(2);
    // Other tests may leave deletions, so drain only this fixture's candidate after its reader exits.
    expect((await f.catalog.space(f.space.id))).toMatchObject({ usedBytes: 0, deletingBytes: 100, activeTransfers: 1 });
    expect((await f.catalog.backend(f.backend.id))?.reservedBytes).toBe(100);
    await expect(f.content.acquireRead(f.object.id, objectId(), objectId(), f.source)).rejects.toThrow('不可读取');
    expect(await f.content.releaseRead(reader.transfer.id, objectId())).toBe(false);
    expect(await f.content.releaseRead(reader.transfer.id, owner)).toBe(true);
    expect(await f.content.releaseRead(reader.transfer.id, owner)).toBe(false);
    let claim = await f.content.claimDelete(owner);
    while (claim && claim.id !== f.object.id) { await f.content.completeDelete(claim); claim = await f.content.claimDelete(owner); }
    expect(claim?.id).toBe(f.object.id);
    expect(await f.content.completeDelete({ ...claim!, deletion: { ...claim!.deletion!, sequence: 0 } })).toBe(false);
    expect(await f.content.completeDelete(claim!)).toBe(true); expect(await f.content.completeDelete(claim!)).toBe(false);
    expect((await f.catalog.space(f.space.id))).toMatchObject({ usedBytes: 0, deletingBytes: 0, objectCount: 0, activeTransfers: 0 });
    expect((await f.catalog.backend(f.backend.id))?.reservedBytes).toBe(0);
    expect((await f.content.delete(f.object.id, input, f.authority)).state).toBe('deleted');
  });
  test('failed deletion retains reservations and waits before retry; backup prevents issuing a new delete', async () => {
    const f = await fixture();
    await f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: 1 }, f.authority);
    const freeze = { id: objectId(), kind: 'backup' as const, backendId: f.backend.id, epoch: 1, active: true };
    await f.catalog.freeze(freeze);
    expect(await f.content.claimDelete(objectId())).toBeUndefined();
    await f.catalog.freeze({ ...freeze, active: false });
    const claim = (await f.content.claimDelete(objectId()))!;
    expect(claim.id).toBe(f.object.id); expect(await f.content.failDelete(claim, 'backend_offline')).toBe(true);
    expect(await f.content.claimDelete(objectId())).toBeUndefined();
    expect((await f.catalog.space(f.space.id))?.deletingBytes).toBe(100);
    expect((await f.catalog.backend(f.backend.id))?.reservedBytes).toBe(100);
  });
});
