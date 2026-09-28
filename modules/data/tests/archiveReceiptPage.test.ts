import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { ArchiveReceiptPageSchema, IDENTITY_HEADERS, OBJECT_STORAGE_LIMITS, type Actor, type UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { archiveBindingRepository } from '../adapters/persistence/archive/bindings';
import { objectReadRepository } from '../adapters/persistence/objectReads';
import { objectAdministration } from '../application/objectAdministration';
import { objectAdminRoutes } from '../http/objectAdminRoutes';
import type { ObjectBackendPlane } from '../ports/objectStorage';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-035 immutable receipt file observations', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture() {
    const f = await objectArchiveFixture(tdb.db), bindings = archiveBindingRepository(tdb.db);
    const appended = await f.plans.append(f.plan.id, { expectedRevision: f.plan.revision, requestKey: objectId(), page: 0,
      entries: [1, 2, 3].map((i) => ({ kind: 'object', objectId: f.object.id, name: `result-${i}` })) }, f.authority);
    const sealed = await f.plans.seal(f.plan.id, objectId(), appended.revision, f.authority), id = objectId();
    await bindings.prepare({ id, taskId: f.taskId, taskGeneration: 2, spaceId: f.space.id, volumeUid: objectId(), outcome: 'failed', archive: { planId: sealed.id, planRevision: sealed.revision, digest: sealed.digest! } }, f.authority);
    await bindings.confirm(id, 1);
    const committed = await bindings.receipt(id, 1, { receiptId: objectId(), disposition: 'archived', stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64), items: [1, 2, 3].map((i) => ({ state: 'saved', name: `result-${i}`, objectId: f.object.id, size: f.object.size, sha256: f.object.sha256 })) });
    const actor: Actor = { userId: objectId() as UserId, isAdmin: false };
    const api = objectAdministration({ catalog: f.catalog, reads: f.reads, plane: {} as ObjectBackendPlane,
      authorizer: { authorize: async (candidate, projectId) => { if (candidate.userId !== actor.userId || projectId !== f.space.projectId) throw forbidden(); } } });
    const app = createApp({ name: 'receipt-page-test' }); app.route('/', objectAdminRoutes(api, async () => false));
    return { ...f, app, actor, id, committed, bindings, headers: { [IDENTITY_HEADERS.userId]: actor.userId }, path: `/v3/object-storage/finalizations/${id}/receipt-items` };
  }
  test('bounded pages preserve immutable receipt identity and leave cleanup and object references unchanged', async () => {
    const f = await fixture(), before = await f.reads.object(f.object.id);
    const first = ArchiveReceiptPageSchema.parse(await (await f.app.request(`${f.path}?limit=2`, { headers: f.headers })).json());
    expect(first.items.map((i) => i.name)).toEqual(['result-1', 'result-2']); expect(first.nextOffset).toBe(2);
    const last = await objectReadRepository(tdb.db).receiptPage(f.id, first.nextOffset!, 2);
    expect(last?.receipt).toEqual(first.receipt); expect(last?.items.map((i) => i.name)).toEqual(['result-3']); expect(last?.nextOffset).toBeNull();
    expect(await f.bindings.get(f.id)).toEqual(f.committed); expect(await f.reads.object(f.object.id)).toEqual(before);
    expect((await f.app.request(`${f.path}?offset=-1`, { headers: f.headers })).status).toBe(400);
    expect((await f.app.request(`${f.path}?limit=101`, { headers: f.headers })).status).toBe(400);
    expect((await f.app.request(f.path)).status).toBe(401);
    expect((await f.app.request(f.path, { headers: { [IDENTITY_HEADERS.userId]: objectId() } })).status).toBe(404);
    expect((await f.app.request(`/v3/object-storage/finalizations/${objectId()}/receipt-items`, { headers: f.headers })).status).toBe(404);
  });
  test('large pages cap UTF-8 bytes without a same-cursor loop; malformed oversized historical entries fail explicitly', async () => {
    const f = await fixture(), large = Array.from({ length: 100 }, (_, i) => ({ state: 'omitted', name: `optional-${i}`, reason: '说明'.repeat(1000) }));
    // Historical corruption/large loss diagnostics are read-only fixtures, not receipt publication requests.
    await tdb.db.execute(sql`UPDATE data.finalization_bindings SET body=jsonb_set(jsonb_set(body,'{items}',${JSON.stringify(large)}::jsonb),'{receipt,itemCount}','100') WHERE id=${f.id}`);
    const page = (await f.reads.receiptPage(f.id, 0, 100))!;
    const { spaceId: _space, ...response } = page;
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(OBJECT_STORAGE_LIMITS.pageBytes);
    expect(page.items.length).toBeGreaterThan(0); expect(page.items.length).toBeLessThan(100); expect(page.nextOffset).toBe(page.items.length);
    await tdb.db.execute(sql`UPDATE data.finalization_bindings SET body=jsonb_set(body,'{items}',${JSON.stringify([{ ...large[0], reason: 'x'.repeat(300_000) }])}::jsonb) WHERE id=${f.id}`);
    await expect(f.reads.receiptPage(f.id, 0, 100)).rejects.toMatchObject({ details: { code: 'archive_receipt_item_too_large' } });
  });
  test('artifact deletion requires reclaimed storage, survives retries and preserves the immutable receipt', async () => {
    const f = await fixture(), request = { requestKey: objectId(), expectedReceiptId: f.committed.receipt!.id, reason: '已交付并完成外部留存', confirmation: 'delete' as const };
    const scope = { spaceId: f.space.id, taskId: f.taskId, actorId: f.actor.userId };
    await expect(f.bindings.deleteArtifacts(f.id, request, scope)).rejects.toMatchObject({ details: { code: 'finalization_artifacts_protected' } });
    await expect(f.bindings.deleteArtifacts(f.id, request, { ...scope, spaceId: objectId() })).rejects.toMatchObject({ kind: 'not_found' });
    const permit = objectId(); await f.bindings.permitDeletion(f.id, 1, permit); await f.bindings.reclaimed(f.id, permit, objectId());
    const freeze = { id: objectId(), backendId: f.backend.id, epoch: 1, kind: 'backup' as const, active: true }; await f.catalog.freeze(freeze);
    await expect(f.bindings.deleteArtifacts(f.id, request, scope)).rejects.toMatchObject({ kind: 'precondition' });
    await f.catalog.freeze({ ...freeze, active: false });
    const read = await f.content.acquireRead(f.object.id, objectId(), objectId(), f.source);
    const result = await f.bindings.deleteArtifacts(f.id, request, scope);
    expect(result).toMatchObject({ receiptId: request.expectedReceiptId, actorId: f.actor.userId, reason: request.reason, objectCount: 1, retainedObjectCount: 0 });
    expect(await f.bindings.deleteArtifacts(f.id, request, scope)).toEqual(result);
    await expect(f.bindings.deleteArtifacts(f.id, { ...request, reason: '另一个请求' }, scope)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.bindings.get(f.id))?.receipt).toEqual(f.committed.receipt);
    expect(await f.catalog.space(f.space.id)).toMatchObject({ usedBytes: 0, deletingBytes: 100 });
    expect(await f.catalog.backend(f.backend.id)).toMatchObject({ reservedBytes: 100 });
    expect(await f.content.claimDelete(objectId())).toBeUndefined(); // Active download still protects the bytes.
    await f.content.releaseRead(read.transfer.id, read.transfer.owner);
    const deleting = (await f.content.claimDelete(objectId()))!; await f.content.completeDelete(deleting);
    expect((await f.catalog.backend(f.backend.id))?.reservedBytes).toBe(0);
    const page = await f.reads.receiptPage(f.id, 0, 2);
    expect(page?.artifactsDeleted).toEqual(result); expect(page?.items.map((i) => i.name)).toEqual(['result-1', 'result-2']);
  });
  test('another reference retains the object after deleting this task artifact set', async () => {
    const f = await fixture(), permit = objectId(); await f.bindings.permitDeletion(f.id, 1, permit); await f.bindings.reclaimed(f.id, permit, objectId());
    await f.content.reference(f.object.id, { requestKey: objectId(), ownerType: 'application', ownerId: 'manual-report', revision: 1 }, 'active', f.authority);
    const result = await f.bindings.deleteArtifacts(f.id, { requestKey: objectId(), expectedReceiptId: f.committed.receipt!.id, reason: '清理这一份产物集', confirmation: 'delete' }, { spaceId: f.space.id, taskId: f.taskId, actorId: f.actor.userId });
    expect(result.retainedObjectCount).toBe(1); expect(await f.reads.object(f.object.id)).toMatchObject({ state: 'ready', referenceCount: 1 });
    expect(await f.catalog.space(f.space.id)).toMatchObject({ usedBytes: 100, deletingBytes: 0 });
  });
});
