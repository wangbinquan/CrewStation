import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { ArchiveReceiptDto, FinalizeBusinessTask, ObjectStorageBlocker, UserId, WorkloadStopBarrier } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { executionOperations } from '../adapters/persistence/executionTables';
import { finalizationOperations } from '../adapters/persistence/finalization/repository';
import { finalizationCompletion } from '../adapters/persistence/finalization/completion';
import { prepareFinalizations } from '../application/finalization/preparation';
import { archiveFinalizations } from '../application/finalization/archiving';
import { cleanupFinalizations } from '../application/finalization/cleanup';
import type { FinalizationPreparation } from '../ports/storage/preparation';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-035 durable finalization preparation worker', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(volumeUid: string | null = newResourceId()) {
    const f = await executionCommandFixture(tdb.db), store = finalizationOperations(tdb.db);
    const parent = (await tdb.db.select().from(executionOperations).where(eq(executionOperations.serviceId, f.serviceId)))[0]!;
    await tdb.db.update(executionOperations).set({ intent: { ...parent.intent, task: { ...parent.intent.task, completionPolicy: 'archive-and-delete' } } }).where(eq(executionOperations.id, parent.id));
    const input: FinalizeBusinessTask = { requestKey: 'finish', expectedGeneration: 1, outcome: 'succeeded', archive: { noArtifactsReason: '无需文件' }, fence: f.fence };
    const accept = () => store.accept(f.serviceId, f.task.id, input, { spaceId: newResourceId(), volumeUid, authorization: { fence: f.fence, source: { ...f.sources.get('trusted')!.source, role: 'prod' } } });
    const calls: string[] = [], observed: Array<{ sequence: number; observation: ObjectStorageBlocker | null }> = [];
    const behavior: { bindFails: boolean; wrongBinding: boolean; stop: WorkloadStopBarrier } = { bindFails: false, wrongBinding: false, stop: { state: 'blocked', count: 0, digest: null, blockedConsumerId: newResourceId() } };
    const ports: FinalizationPreparation = {
      archive: { commitArchive: async () => { throw new Error('not used in preparation'); }, bind: async (id: string) => {
        calls.push('bind'); if (behavior.bindFails) throw new Error('backend offline');
        const op = (await store.get(id))!;
        return { id, revision: op.view.revision, taskId: behavior.wrongBinding ? newResourceId() : op.view.taskId, taskGeneration: op.view.taskGeneration, volumeUid: op.volumeUid };
      }, observe: async (_id: string, _rev: number, sequence: number, observation: ObjectStorageBlocker | null) => { observed.push({ sequence, observation }); return true; } },
      runtime: { freezeBusinessStorage: async () => { calls.push('freeze'); }, stopBusinessStorage: async () => { calls.push('stop'); return behavior.stop; } },
    };
    const worker = () => prepareFinalizations(finalizationOperations(tdb.db), finalizationCompletion(tdb.db), ports, f.runner);
    const due = () => tdb.db.execute(sql`UPDATE business_task.finalizations SET next_attempt_at=now()-interval '1 second' WHERE service_id=${f.serviceId}`);
    return { ...f, accept, store, behavior, calls, observed, worker, due, ports };
  }
  test('restarts retain result confirmation, stop remains independent, and observations match durable state', async () => {
    const f = await fixture(), op = await f.accept();
    await f.worker()(op.id);
    expect(f.calls).toEqual(['freeze', 'bind']); expect((await f.store.get(op.id))!.view.phase).toBe('draining');
    await f.worker()(op.id);
    const blocked = (await f.store.get(op.id))!;
    expect(blocked.completionScan).toMatchObject({ complete: true, count: 0 });
    expect(blocked.view).toMatchObject({ phase: 'draining', computeStopped: false, phaseState: 'blocked' });
    expect(f.observed.at(-1)?.observation).toMatchObject({ operationId: op.id, code: 'finalization_stop_pending' });
    await f.due(); await f.worker()(op.id);
    expect(f.observed.at(-1)?.observation?.since).toBe(blocked.observationSince!);
    f.behavior.stop = { state: 'complete', count: 1, digest: 'a'.repeat(64), blockedConsumerId: null };
    await f.due(); await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'archiving', computeStopped: true, artifactsReady: false, storageReclaimed: null });
    expect(f.observed.at(-1)?.observation).toBeNull(); expect(await f.worker()(op.id)).toBe(0);
  });
  test('active execution blocks before stopping Pods or sending implicit cancel commands', async () => {
    const f = await fixture(); await f.request(f.path, f.input);
    const op = await f.accept(); await f.worker()(op.id); const before = f.commands.length;
    await f.worker()(op.id);
    expect(f.calls).toEqual(['freeze', 'bind']); expect(f.commands).toHaveLength(before);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'draining', phaseState: 'blocked', errorCode: 'finalization_execution_pending' });
    expect(f.observed.at(-1)?.observation?.code).toBe('finalization_execution_pending');
  });
  test('an initially unknown volume is pinned from runtime evidence before archive binding, including retry after a lost bind reply', async () => {
    const f = await fixture(null), op = await f.accept(), uid = newResourceId(); let known = false;
    f.ports.runtime.resolveBusinessStorage = async () => { if (!known) throw precondition('创建结果未知', { code: 'workspace_volume_identity_pending' }); return uid; };
    await f.worker()(op.id);
    expect(f.calls).toEqual(['freeze']); expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'requested', errorCode: 'workspace_volume_identity_pending' });
    await expect(f.store.revise(f.serviceId, f.task.id, { requestKey: 'early', expectedGeneration: 2, expectedRevision: 1, reason: '修订', archive: { noArtifactsReason: '无产物' }, confirmDiscard: false },
      { administrative: { userId: newResourceId() as UserId, reason: '修订' } })).rejects.toMatchObject({ details: { code: 'workspace_volume_identity_pending' } });
    known = true; f.behavior.bindFails = true; await f.due(); await f.worker()(op.id);
    expect((await f.store.get(op.id))!).toMatchObject({ volumeUid: uid, evidence: { volumeIdentityConfirmed: true }, view: { phase: 'requested' } });
    f.behavior.bindFails = false; await f.due();
    const claimed = (await f.store.claim({ id: op.id, owner: newResourceId(), leaseSeconds: 90 }))!;
    const lease = { id: op.id, owner: claimed.lease!.owner, sequence: claimed.sequence, revision: 1 };
    await expect(f.store.bindVolume(lease, null)).rejects.toThrow(); await expect(f.store.bindVolume(lease, newResourceId())).rejects.toThrow();
    expect((await f.store.bindVolume(lease, uid))!.volumeUid).toBe(uid);
    await f.store.progress(lease, { phase: 'requested', phaseState: 'pending' }); await f.worker()(op.id);
    expect((await f.store.get(op.id))!).toMatchObject({ volumeUid: uid, view: { phase: 'draining' } });
  });
  test('dependency failures and mismatched bindings persist a retryable or blocked record without false progress', async () => {
    const f = await fixture(), op = await f.accept(); f.behavior.bindFails = true;
    await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'requested', phaseState: 'retrying' });
    f.behavior.bindFails = false; f.behavior.wrongBinding = true; await f.due(); await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'requested', phaseState: 'blocked', computeStopped: false });
    f.behavior.wrongBinding = false; await f.due(); await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view.phase).toBe('draining'); expect(f.calls).not.toContain('stop');
  });
  test('a durable loss receipt survives a lost operator response, waives missing results only and never bypasses execution stopping', async () => {
    const f = await fixture(); await f.request(f.path, f.input);
    const op = await f.accept(); await f.worker()(op.id); await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view.errorCode).toBe('finalization_execution_pending');
    const receipt: ArchiveReceiptDto = { id: op.id, taskId: f.task.id, finalizationId: op.id, finalizationRevision: 1, taskGeneration: 2, volumeUid: op.volumeUid,
      manifestDigest: 'a'.repeat(64), disposition: 'loss', itemCount: 1, noArtifactsReason: null, lossActorId: newResourceId() as UserId, lossReason: '报告损坏，明确确认损失', createdAt: new Date().toISOString() };
    f.ports.archive.lossReceipt = async () => receipt;
    await f.due(); await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'draining', receipt, computeStopped: false, artifactsReady: false, storageReclaimed: null });
    expect(f.calls).not.toContain('stop');
    await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'draining', errorCode: 'finalization_stop_pending', computeStopped: false });
    expect((await f.store.get(op.id))!.evidence.completionProofDigest).toBeUndefined();
    f.behavior.stop = { state: 'complete', count: 1, digest: 'a'.repeat(64), blockedConsumerId: null };
    await f.due(); await f.worker()(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'archiving', computeStopped: true, artifactsReady: false });
    f.ports.archive.commitArchive = async (_id, _revision, evidence) => {
      expect(evidence).toEqual({ stopProofDigest: 'a'.repeat(64), completionProofDigest: null }); return { receipt };
    };
    await archiveFinalizations(finalizationOperations(tdb.db), f.ports.archive)(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'archived', receipt, artifactsReady: false, storageReclaimed: null });
  });
  test('a lost data receipt response retries the same archive and never treats the receipt as reclaimed storage', async () => {
    const f = await fixture(), op = await f.accept();
    f.behavior.stop = { state: 'complete', count: 1, digest: 'a'.repeat(64), blockedConsumerId: null };
    await f.worker()(op.id); await f.worker()(op.id);
    const receipt: ArchiveReceiptDto = { id: newResourceId(), taskId: f.task.id, finalizationId: op.id, finalizationRevision: 1, taskGeneration: 2, volumeUid: op.volumeUid,
      manifestDigest: 'a'.repeat(64), disposition: 'empty', itemCount: 0, noArtifactsReason: '无需文件', lossActorId: null, lossReason: null, createdAt: new Date().toISOString() };
    let delivered = false;
    f.ports.archive.commitArchive = async () => { if (!delivered) { delivered = true; throw new Error('reply lost'); } return { receipt }; };
    await archiveFinalizations(f.store, f.ports.archive)(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'archiving', phaseState: 'retrying', receipt: null });
    await f.due(); await archiveFinalizations(finalizationOperations(tdb.db), f.ports.archive)(op.id);
    expect((await f.store.get(op.id))!.view).toMatchObject({ phase: 'archived', receipt, artifactsReady: true, volumeDisposition: 'pending', storageReclaimed: null });
    expect(await archiveFinalizations(f.store, f.ports.archive)(op.id)).toBe(0);
  });
  test('cleanup keeps its original permit across lost responses and completes only after physical evidence and owner ACKs', async () => {
    const f = await fixture(), op = await f.accept();
    f.behavior.stop = { state: 'complete', count: 0, digest: 'a'.repeat(64), blockedConsumerId: null };
    await f.worker()(op.id); await f.worker()(op.id);
    const receipt: ArchiveReceiptDto = { id: newResourceId(), taskId: f.task.id, finalizationId: op.id, finalizationRevision: 1, taskGeneration: 2, volumeUid: op.volumeUid,
      manifestDigest: 'a'.repeat(64), disposition: 'empty', itemCount: 0, noArtifactsReason: '无需文件', lossActorId: null, lossReason: null, createdAt: new Date().toISOString() };
    f.ports.archive.commitArchive = async () => ({ receipt });
    await archiveFinalizations(f.store, f.ports.archive)(op.id);
    const permits: string[] = [], calls: string[] = []; let stopReady = false, replyLost = true, reclaimed = false, ownerReplyLost = true;
    const proof = { id: newResourceId(), permitId: op.id, volumeUid: op.volumeUid, pvUid: 'pv', disposition: 'deleted' as const, storageReclaimed: true as const, source: 'local-path-probe' as const, observedAt: new Date().toISOString() };
    f.ports.archive.permitDeletion = async (_id, _revision, permit) => { permits.push(permit); calls.push('data-permit'); };
    f.ports.archive.reclaimed = async (_id, permit, id) => { expect(permit).toBe(op.id); expect(id).toBe(proof.id); calls.push('data-reclaimed'); };
    f.ports.runtime.storageCleanup = {
      prepare: async () => stopReady ? { state: 'complete', count: 2, digest: 'b'.repeat(64), blockedConsumerId: null } : { state: 'blocked', count: 1, digest: null, blockedConsumerId: 'helper' },
      release: async (_input, permit) => { expect(permit.volumeUid).toBe(op.volumeUid); calls.push('release'); if (replyLost) { replyLost = false; throw new Error('reply lost'); } },
      proof: async () => reclaimed ? proof : null,
      complete: async () => { calls.push('complete'); if (ownerReplyLost) { ownerReplyLost = false; throw new Error('owner reply lost'); } },
    };
    const cleanup = () => cleanupFinalizations(finalizationOperations(tdb.db), f.ports)(op.id);
    await cleanup(); expect(permits).toEqual([]); expect((await f.store.get(op.id))?.view.phase).toBe('archived');
    stopReady = true; await f.due(); await cleanup();
    expect((await f.store.get(op.id))?.view).toMatchObject({ phase: 'archived', phaseState: 'retrying', storageReclaimed: null });
    await f.due(); await cleanup(); expect(permits).toEqual([op.id, op.id]);
    expect((await f.store.get(op.id))?.view.phase).toBe('cleaning');
    await cleanup(); expect(calls).not.toContain('complete');
    reclaimed = true; await f.due(); await cleanup();
    expect((await f.store.get(op.id))?.view).toMatchObject({ phase: 'cleaning', storageReclaimed: null });
    await f.due(); await cleanup();
    expect((await f.store.get(op.id))?.view).toMatchObject({ phase: 'completed', storageReclaimed: true, volumeDisposition: 'deleted', outcome: 'succeeded' });
    expect(calls.slice(-4)).toEqual(['data-reclaimed', 'complete', 'data-reclaimed', 'complete']);
    expect(await cleanup()).toBe(0);
  });
});
