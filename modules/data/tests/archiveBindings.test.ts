import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { dataMigrations } from '../wiring';
import { archiveBindingRepository } from '../adapters/persistence/archive/bindings';
import { objectArchiveFixture } from './objectArchiveFixture';
import { objectId } from './objectFixtures';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
beforeAll(async () => { if (available) tdb = await createTestDatabase([dataMigrations]); });
afterAll(async () => { await tdb?.drop(); });
async function fixture() {
  const f = await objectArchiveFixture(tdb.db), bindings = archiveBindingRepository(tdb.db);
  await f.plans.append(f.plan.id, { requestKey: objectId(), page: 0, expectedRevision: 1, entries: [{ kind: 'object', objectId: f.object.id, name: 'report' }] }, f.authority);
  const plan = await f.plans.seal(f.plan.id, objectId(), 2, f.authority), archive = { planId: plan.id, planRevision: plan.revision, digest: plan.digest! };
  const input = { id: objectId(), taskId: f.taskId, taskGeneration: 3, volumeUid: objectId(), outcome: 'succeeded' as const, spaceId: f.space.id, archive };
  const binding = await bindings.prepare(input, f.authority);
  const receipt = { receiptId: objectId(), disposition: 'archived' as const, stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64), items: [{ state: 'saved' as const, name: 'report', objectId: f.object.id, size: f.object.size, sha256: f.object.sha256 }] };
  return { ...f, bindings, binding, input, receipt };
}
describe.skipIf(!available)('finalization binding is the single archive decision', () => {
  test('prepare is idempotent, only a confirmed binding accepts a receipt, and the receipt survives request replay', async () => {
    const f = await fixture();
    expect((await f.bindings.prepare(f.input, f.authority)).id).toBe(f.binding.id);
    await expect(f.bindings.prepare({ ...f.input, outcome: 'failed' }, f.authority)).rejects.toThrow('幂等键');
    await expect(f.bindings.receipt(f.binding.id, 1, f.receipt)).rejects.toThrow('尚未确认');
    await f.bindings.confirm(f.binding.id, 1);
    const committed = await f.bindings.receipt(f.binding.id, 1, f.receipt);
    expect(committed).toMatchObject({ state: 'receipted', receipt: { taskGeneration: 3, volumeUid: f.input.volumeUid, finalizationRevision: 1 } });
    expect((await f.bindings.receipt(f.binding.id, 1, f.receipt)).receipt).toEqual(committed.receipt);
    await expect(f.bindings.receipt(f.binding.id, 1, { ...f.receipt, completionProofDigest: 'c'.repeat(64) })).rejects.toThrow('幂等键');
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(2);
    await expect(f.content.delete(f.object.id, { requestKey: objectId(), expectedRevision: (await f.reads.object(f.object.id))!.revision }, f.authority)).rejects.toThrow('引用');
    const permitId = objectId(), proofId = objectId();
    expect((await f.bindings.permitDeletion(f.binding.id, 1, permitId)).state).toBe('delete-started');
    await expect(f.bindings.reclaimed(f.binding.id, objectId(), proofId)).rejects.toThrow('清理许可');
    expect((await f.bindings.reclaimed(f.binding.id, permitId, proofId)).state).toBe('completed');
    expect((await f.bindings.reclaimed(f.binding.id, permitId, proofId)).reclaimProofId).toBe(proofId);
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(1);
  });
  test('revision and old receipt racing have one winner; a lost revision reply is recoverable without rewriting history', async () => {
    for (let i = 0; i < 4; i++) {
      const f = await fixture(); await f.bindings.confirm(f.binding.id, 1);
      const request = { expectedRevision: 1, requestKey: objectId(), archive: { noArtifactsReason: '无需保留文件' }, reason: '修正产物选择' };
      const actions = [() => f.bindings.revise(f.binding.id, request, f.authority), () => f.bindings.receipt(f.binding.id, 1, f.receipt)];
      if (i % 2) actions.reverse();
      const results = await Promise.allSettled(actions.map((run) => run()));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const current = (await f.bindings.get(f.binding.id))!;
      if (current.revision === 2) {
        expect(current.receipt).toBeNull(); expect(current.noArtifactsReason).toBe('无需保留文件');
        expect((await f.bindings.revise(f.binding.id, request, f.authority)).revision).toBe(2);
        await expect(f.bindings.revise(f.binding.id, { ...request, reason: 'changed' }, f.authority)).rejects.toThrow('幂等键');
        await expect(f.bindings.receipt(f.binding.id, 1, f.receipt)).rejects.toThrow('变化');
        expect((await f.reads.object(f.object.id))?.referenceCount).toBe(0);
      } else {
        expect(current.receipt?.manifestDigest).toBe(f.binding.manifestDigest);
        await expect(f.bindings.revise(f.binding.id, request, f.authority)).rejects.toThrow('尚未提交收据');
        expect((await f.reads.object(f.object.id))?.referenceCount).toBe(2);
      }
    }
  });
  test('aborting unaccepted preparation keeps its plan protected and permits a different operation; accepted bindings cannot abort', async () => {
    const f = await fixture();
    await expect(f.bindings.prepare({ ...f.input, id: objectId() }, f.authority)).rejects.toThrow('已有');
    expect((await f.bindings.abort(f.binding.id, 1)).state).toBe('aborted');
    expect((await f.plans.get(f.plan.id))?.state).toBe('sealed');
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(1);
    const next = await f.bindings.prepare({ ...f.input, id: objectId() }, f.authority);
    await expect(f.bindings.confirm(f.binding.id, 1)).rejects.toThrow('撤销');
    await f.bindings.confirm(next.id, 1);
    await expect(f.bindings.abort(next.id, 1)).rejects.toThrow('不能撤销');
  });
  test('backup and detected corruption forbid new delete permits while all archive references remain', async () => {
    const f = await fixture(); await f.bindings.confirm(f.binding.id, 1); await f.bindings.receipt(f.binding.id, 1, f.receipt);
    const freeze = { id: objectId(), backendId: f.backend.id, kind: 'backup' as const, epoch: 1, active: true };
    await f.catalog.freeze(freeze);
    await expect(f.bindings.permitDeletion(f.binding.id, 1, objectId())).rejects.toThrow('冻结');
    await f.catalog.freeze({ ...freeze, active: false });
    await f.content.markDegraded(f.object.id, 'missing');
    await expect(f.bindings.permitDeletion(f.binding.id, 1, objectId())).rejects.toThrow('不可读取');
    expect((await f.bindings.get(f.binding.id))?.state).toBe('receipted');
    expect((await f.reads.object(f.object.id))?.referenceCount).toBe(2);
  });
  test('backup waits for issued deletion permits and lets their lost replies and final ACK drain', async () => {
    const f = await fixture(); await f.bindings.confirm(f.binding.id, 1); await f.bindings.receipt(f.binding.id, 1, f.receipt);
    const permit = objectId(); await f.bindings.permitDeletion(f.binding.id, 1, permit);
    const freeze = { id: objectId(), backendId: f.backend.id, kind: 'backup' as const, epoch: 1, active: true };
    await f.catalog.freeze(freeze);
    expect(await f.catalog.freezeStatus(freeze.id)).toEqual({ phase: 'draining', epoch: 1, blockers: [{ kind: 'volume-deletion', count: 1 }] });
    expect((await f.bindings.permitDeletion(f.binding.id, 1, permit)).deletePermitId).toBe(permit);
    await f.bindings.reclaimed(f.binding.id, permit, objectId());
    expect(await f.catalog.freezeStatus(freeze.id)).toEqual({ phase: 'frozen', epoch: 1, blockers: [] });
    expect((await f.reads.object(f.object.id))!.referenceCount).toBe(1);
    await f.catalog.freeze({ ...freeze, active: false });
    expect((await f.catalog.freezeStatus(freeze.id)).phase).toBe('released');
  });
  test('missing required items, substituted objects and forged file provenance cannot authorize collection', async () => {
    const f = await fixture(); await f.bindings.confirm(f.binding.id, 1);
    await expect(f.bindings.receipt(f.binding.id, 1, { ...f.receipt, items: [] })).rejects.toThrow('逐项');
    await expect(f.bindings.receipt(f.binding.id, 1, { ...f.receipt, items: [{ state: 'omitted', name: 'report', reason: 'missing' }] })).rejects.toThrow('必需');
    const plan = await f.plans.create(f.space.id, f.taskId, objectId(), objectId(), f.authority);
    await f.plans.append(plan.id, { requestKey: objectId(), page: 0, expectedRevision: 1, entries: [{ kind: 'file', path: 'report.txt', name: 'report', required: true }] }, f.authority);
    const sealed = await f.plans.seal(plan.id, objectId(), 2, f.authority);
    await f.bindings.revise(f.binding.id, { expectedRevision: 1, requestKey: objectId(), archive: { planId: sealed.id, planRevision: sealed.revision, digest: sealed.digest! }, reason: '从工作卷收集' }, f.authority);
    await expect(f.bindings.receipt(f.binding.id, 2, f.receipt)).rejects.toThrow('工作卷归档');
    expect((await f.bindings.get(f.binding.id))?.receipt).toBeNull();
  });
});
