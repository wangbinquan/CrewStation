import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AcceptedArchiveFinalization, Actor, TaskId, UserId } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';
import { archiveBindingRepository } from '../adapters/persistence/archive/bindings';
import { archiveLossRepository } from '../adapters/persistence/archive/loss';
import { archiveAdministration } from '../application/archiveAdministration';
import { archiveFinalization } from '../application/archiveFinalization';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('explicit irreversible archive loss receipts', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([dataMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(saved = true) {
    const f = await objectArchiveFixture(tdb.db), owner = objectId() as UserId, actor: Actor = { userId: owner, isAdmin: false };
    await f.plans.append(f.plan.id, { requestKey: 'page', expectedRevision: 1, page: 0, entries: [
      { kind: 'file', name: 'missing', path: 'report.txt', required: true }, ...(saved ? [{ kind: 'object' as const, name: 'kept', objectId: f.object.id }] : []),
    ] }, f.authority);
    const plan = await f.plans.seal(f.plan.id, 'seal', 2, f.authority), bindings = archiveBindingRepository(tdb.db), loss = archiveLossRepository(tdb.db);
    const scope = { taskId: f.taskId as TaskId, projectId: f.source.projectId, serviceId: f.source.serviceId };
    const intent: AcceptedArchiveFinalization = { ...scope, id: objectId(), taskGeneration: 2, spaceId: f.space.id, volumeUid: objectId(), outcome: 'failed', archive: { planId: plan.id, planRevision: plan.revision, digest: plan.digest! } };
    const tasks = { accepted: async () => intent, read: async () => ({ projectId: scope.projectId, completionPolicy: 'archive-and-delete' as const }) };
    const api = archiveFinalization(bindings, tasks, { plans: f.plans, reads: f.reads }); await api.bind(intent.id);
    const admin = archiveAdministration({ ...f, tasks, bindings, loss, authorizer: { authorize: async (who, project, action) => {
      expect(action).toBe('manage-task-storage'); if (project !== scope.projectId || !who.isAdmin && who.userId !== owner) throw forbidden();
    } } });
    const preview = await admin.assessLoss(actor, scope, intent.id, 1, { offset: 0, limit: 1 });
    const input = { requestKey: 'explicit-loss', expectedRevision: 1, assessmentDigest: 'd'.repeat(64), reason: '原卷损坏，确认无法恢复缺失报告', confirmation: 'accept-loss' as const };
    return { ...f, actor, scope, intent, bindings, loss, api, admin, preview, input, owner };
  }
  test('review is paged and read-only; owner confirmation preserves verified files and never marks missing files ready', async () => {
    const f = await fixture(), before = (await f.reads.object(f.object.id))!.referenceCount;
    expect(f.preview).toMatchObject({ itemCount: 2, lostCount: 1, savedCount: 1, nextOffset: 1, volumeUid: f.intent.volumeUid });
    expect(f.preview.items).toMatchObject([{ item: { state: 'lost', name: 'missing' }, path: 'report.txt' }]);
    const second = await f.admin.assessLoss(f.actor, f.scope, f.intent.id, 1, { offset: 1, limit: 1 });
    expect(second.assessmentDigest).toBe(f.preview.assessmentDigest); expect(second.items).toMatchObject([{ item: { state: 'saved', objectId: f.object.id }, referenceCount: before }]);
    expect((await f.reads.object(f.object.id))!.referenceCount).toBe(before);
    await expect(f.admin.confirmLoss({ userId: objectId() as UserId, isAdmin: false }, f.scope, f.intent.id, f.input, f.preview.assessmentDigest)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.admin.confirmLoss(f.actor, { ...f.scope, taskId: objectId() as TaskId }, f.intent.id, f.input, f.preview.assessmentDigest)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.admin.confirmLoss(f.actor, f.scope, f.intent.id, f.input, 'a'.repeat(64))).rejects.toMatchObject({ details: { code: 'archive_loss_assessment_changed' } });
    const receipt = await f.admin.confirmLoss(f.actor, f.scope, f.intent.id, f.input, f.preview.assessmentDigest);
    expect(receipt).toMatchObject({ disposition: 'loss', lossActorId: f.owner, lossReason: f.input.reason, itemCount: 2 });
    expect((await f.bindings.get(f.intent.id))?.stopProofDigest).toBeNull();
    expect(await f.admin.confirmLoss(f.actor, f.scope, f.intent.id, f.input, null)).toEqual(receipt);
    await expect(f.admin.confirmLoss(f.actor, f.scope, f.intent.id, { ...f.input, reason: 'rewrite audit' }, null)).rejects.toThrow();
    expect((await f.reads.receiptPage(f.intent.id, 0, 100))?.items.map((item) => item.state)).toEqual(['lost', 'saved']);
    expect((await f.reads.object(f.object.id))!.referenceCount).toBe(2);
    await expect(f.bindings.receipt(f.intent.id, 1, { receiptId: f.intent.id, items: [], disposition: 'empty', stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) })).rejects.toThrow();
  });
  test('loss can replace result completeness but cannot issue deletion before stop proof, or bypass backup and saved-object protection', async () => {
    const f = await fixture(), freeze = { id: objectId(), kind: 'backup' as const, backendId: f.backend.id, epoch: 1, active: true };
    await f.catalog.freeze(freeze);
    await expect(f.admin.confirmLoss(f.actor, f.scope, f.intent.id, f.input, f.preview.assessmentDigest)).rejects.toMatchObject({ details: { code: 'object_storage_frozen' } });
    await f.catalog.freeze({ ...freeze, active: false });
    await f.admin.confirmLoss(f.actor, f.scope, f.intent.id, f.input, f.preview.assessmentDigest);
    await expect(f.api.permitDeletion(f.intent.id, 1, f.intent.id)).rejects.toThrow();
    expect((await f.api.commitArchive(f.intent.id, 1, { stopProofDigest: 'a'.repeat(64), completionProofDigest: null })).receipt?.disposition).toBe('loss');
    expect((await f.bindings.get(f.intent.id))?.completionProofDigest).toBeNull();
    await f.catalog.updateBackend(f.backend.id, { expectedRevision: 1, name: f.backend.name, state: 'offline', budgetBytes: f.backend.budgetBytes });
    await expect(f.api.permitDeletion(f.intent.id, 1, f.intent.id)).rejects.toMatchObject({ details: { code: 'archive_backend_unavailable' } });
    expect((await f.bindings.get(f.intent.id))?.deletePermitId).toBeNull();
    await expect(f.api.commitArchive(f.intent.id, 1, { stopProofDigest: 'b'.repeat(64), completionProofDigest: null })).rejects.toThrow();
  });
  test('when no artifact is saved, confirmed loss can proceed while storage backend is offline, still requiring stopping and reclaim acknowledgement', async () => {
    const f = await fixture(false);
    await f.admin.confirmLoss(f.actor, f.scope, f.intent.id, f.input, f.preview.assessmentDigest);
    await f.api.commitArchive(f.intent.id, 1, { stopProofDigest: 'a'.repeat(64), completionProofDigest: null });
    await f.catalog.updateBackend(f.backend.id, { expectedRevision: 1, name: f.backend.name, state: 'offline', budgetBytes: f.backend.budgetBytes });
    await f.api.permitDeletion(f.intent.id, 1, f.intent.id);
    expect((await f.bindings.get(f.intent.id))?.state).toBe('delete-started');
    await f.api.reclaimed(f.intent.id, f.intent.id, objectId());
    expect((await f.bindings.get(f.intent.id))?.state).toBe('completed');
    expect((await f.api.lossReceipt(f.intent.id, 1))?.disposition).toBe('loss');
  });
});
