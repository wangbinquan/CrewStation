import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { ArchiveReceiptDto, BusinessSubtaskV3Dto, ExecutionCompletionProof, FinalizeBusinessTask, RunnerBusinessEvent, TaskId, UserId } from '@crewstation/contracts';
import { forbidden, jsonHash, newResourceId } from '@crewstation/kernel';
import { taskStorageQueries } from '../application/finalization/queries';
import { recoveryQueries } from '../adapters/persistence/recovery/queries';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { executionOperations } from '../adapters/persistence/executionTables';
import { finalizationOperations } from '../adapters/persistence/finalization/repository';
import { finalizationCompletion } from '../adapters/persistence/finalization/completion';
import { drizzleExecutionProjection } from '../adapters/persistence/execution/projection';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';
import type { FinalizationAdmission } from '../ports/storage/finalizations';
import type { FinalizationOperation, FinalizationProgress } from '../domain/finalization/operation';
import type { FinalizationPreparation } from '../ports/storage/preparation';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-035 durable finalization intake and completion barriers', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(policy = true) {
    const f = await executionCommandFixture(tdb.db), store = finalizationOperations(tdb.db);
    // New policy admission remains disabled until runtime safety is wired. Seed an immutable accepted task to test its journal.
    if (policy) {
      const parent = (await tdb.db.select().from(executionOperations).where(eq(executionOperations.serviceId, f.serviceId)))[0]!;
      await tdb.db.update(executionOperations).set({ intent: { ...parent.intent, task: { ...parent.intent.task, completionPolicy: 'archive-and-delete' } } }).where(eq(executionOperations.id, parent.id));
    }
    const input: FinalizeBusinessTask = { requestKey: 'finish', expectedGeneration: 1, outcome: 'succeeded', archive: { noArtifactsReason: '本任务无需保留文件' }, fence: f.fence };
    const admission: FinalizationAdmission = { spaceId: newResourceId(), volumeUid: newResourceId(), authorization: { fence: f.fence, source: { ...f.sources.get('trusted')!.source, role: 'prod' } } };
    const accept = (body = input) => store.accept(f.serviceId, f.task.id, body, admission);
    return { ...f, commandInput: f.input, store, input, admission, accept };
  }
  const leaseOf = (op: FinalizationOperation) => ({ id: op.id, owner: op.lease!.owner, sequence: op.sequence, revision: op.view.revision });
  test('public intake verifies both module owners before freezing and replays without revalidating a bound manifest', async () => {
    const f = await fixture(), path = `/v3/business-tasks/${f.task.id}/finalize`, spaceId = newResourceId(), volumeUid = newResourceId();
    let calls = 0, fail = true;
    const ports: FinalizationPreparation = {
      preflight: async (caller, taskId, archive) => {
        calls++; expect(caller.token).toBe('trusted'); expect(taskId).toBe(f.task.id); expect(archive).toEqual(f.input.archive);
        if (fail) throw forbidden('invalid archive'); return { spaceId };
      },
      archive: { bind: async () => { throw new Error('not used'); }, commitArchive: async () => { throw new Error('not used'); }, observe: async () => true },
      runtime: { freezeBusinessStorage: async () => {}, stopBusinessStorage: async () => { throw new Error('not used'); } },
    };
    const http = f.make({ finalizationPreparation: ports });
    expect((await http.request(path, f.input, 'fake')).status).toBe(403); expect(calls).toBe(0);
    expect((await f.request(path, f.input)).status).toBe(412);
    expect((await http.request(path, { ...f.input, volumeUid })).status).toBe(400);
    expect((await http.request(path, f.input)).status).toBe(403);
    expect(await f.store.forTask(f.serviceId, f.task.id)).toBeUndefined();
    fail = false; f.env.businessWorkspace = { volumeUid, phase: 'ready' };
    const accepted = await http.request(path, f.input); expect(accepted.status).toBe(202);
    const view = await accepted.json(); expect(view).toMatchObject({ phase: 'requested', taskGeneration: 2 });
    expect(await f.store.forTask(f.serviceId, f.task.id)).toMatchObject({ spaceId, volumeUid });
    fail = true; f.env.businessWorkspace = { volumeUid: newResourceId(), phase: 'ready' };
    expect(await (await http.request(path, f.input)).json()).toEqual(view); expect(calls).toBe(2);
    expect((await http.request(path, { ...f.input, outcome: 'failed' })).status).toBe(409);
    expect(await (await http.request(`/v3/business-tasks/${f.task.id}/finalization`)).json()).toEqual(view);
    expect((await http.request(`/v3/business-tasks/${newResourceId()}/finalization`)).status).toBe(404);
    expect((await http.request(`/v3/business-tasks/${f.task.id}/finalization`, undefined, 'fake')).status).toBe(403);
    expect((await f.store.forTask(f.serviceId, f.task.id))!.view.phase).toBe('requested');
  });
  test('storage observation uses immutable project authority and never claims or advances accepted work', async () => {
    const f = await fixture(), op = await f.accept(), actor = { userId: newResourceId() as UserId, isAdmin: false };
    const authorized: unknown[] = [], query = taskStorageQueries(recoveryQueries(tdb.db), f.store, { authorize: async (...args) => { authorized.push(args); return true; } });
    expect(await query.describeTaskStorage(actor, f.task.id)).toMatchObject({ projectId: f.projectId, serviceId: f.serviceId, completionPolicy: 'archive-and-delete', finalization: { operationId: op.id, phase: 'requested' } });
    expect(authorized).toEqual([[actor, f.projectId, 'view']]);
    expect(await f.store.get(op.id)).toEqual(op);
    const http = f.make(); http.app.route('/', http.module.http.user);
    const path = `/v3/object-storage/tasks/${f.task.id}`;
    expect((await http.request(path)).status).toBe(403);
    const response = await http.request(path, undefined, 'trusted', { 'x-cs-user-id': actor.userId });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ taskId: f.task.id, finalization: { operationId: op.id } });
    expect(await f.store.get(op.id)).toEqual(op);
    const denied = taskStorageQueries(recoveryQueries(tdb.db), f.store, { authorize: async () => { throw forbidden('different project'); } });
    await expect(denied.describeTaskStorage(actor, f.task.id)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await f.store.get(op.id)).toEqual(op);
    const legacy = await fixture(false);
    expect(await query.describeTaskStorage(actor, legacy.task.id)).toMatchObject({ completionPolicy: 'legacy', finalization: null });
    await expect(query.describeTaskStorage(actor, newResourceId() as TaskId)).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('concurrent replay freezes once; late new execution/material is rejected while cancellation remains legal', async () => {
    const f = await fixture(), child = await (await f.request(f.path, f.commandInput)).json();
    expect(child.state).toBe('running');
    const operations = await Promise.all(Array.from({ length: 5 }, () => f.accept()));
    expect(new Set(operations.map((o) => o.id)).size).toBe(1);
    expect(operations[0]!.view).toMatchObject({ phase: 'requested', taskGeneration: 2, computeStopped: false, receipt: null });
    expect(await f.make().module.api.acceptedFinalization(operations[0]!.id)).toMatchObject({ id: operations[0]!.id, projectId: f.projectId, serviceId: f.serviceId, taskId: f.task.id, taskGeneration: 2, spaceId: f.admission.spaceId, volumeUid: f.admission.volumeUid, archive: f.input.archive });
    const root = `/v3/business-tasks/${f.task.id}`;
    expect(await (await f.request(root)).json()).toMatchObject({ state: 'finalizing', generation: 2, completionPolicy: 'archive-and-delete' });
    const rejected = await f.request(f.path, { kind: 'command', requestKey: 'late', name: 'late', argv: ['true'], fence: f.fence });
    expect(rejected.status).toBe(409);
    expect((await f.request(`${root}/materials`, { requestKey: 'late-material', skills: [], fence: f.fence })).status).toBe(409);
    expect((await f.request(`${f.path}/${child.id}/cancel`, { requestKey: 'stop', expectedAttempt: 1, fence: f.fence })).status).toBe(202);
    expect((await f.request(`${root}/close`, { requestKey: 'bypass', expectedGeneration: 2, fence: f.fence })).status).toBe(412);
    expect((await f.request(`${root}/resume`, { requestKey: 'bypass', expectedGeneration: 2, fence: f.fence })).status).toBe(409);
    await expect(f.accept({ ...f.input, outcome: 'cancelled' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.accept({ ...f.input, requestKey: 'different' })).rejects.toMatchObject({ kind: 'conflict' });
  });
  test('invalid authority, stale generation and legacy policy do not freeze the task', async () => {
    const f = await fixture();
    await expect(f.store.accept(f.serviceId, f.task.id, f.input, { ...f.admission, authorization: { source: { ...f.sources.get('trusted')!.source, role: 'prod' } } })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.accept({ ...f.input, expectedGeneration: 2 })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.store.forTask(f.serviceId, f.task.id)).toBeUndefined();
    expect(await (await f.request(`/v3/business-tasks/${f.task.id}`)).json()).toMatchObject({ state: 'running', generation: 1 });
    const legacy = await fixture(false);
    await expect(legacy.accept()).rejects.toMatchObject({ details: { code: 'finalization_policy_required' } });
    await expect(f.store.accept(legacy.serviceId, f.task.id, f.input, f.admission)).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('accepted work survives service epoch expiry, process restart and expired event logs', async () => {
    const f = await fixture();
    await tdb.db.execute(sql`INSERT INTO business_task.execution_logs (task_id,service_id,expired) VALUES (${f.task.id},${f.serviceId},true) ON CONFLICT (task_id) DO UPDATE SET expired=true`);
    const op = await f.accept();
    await tdb.db.execute(sql`UPDATE business_task.execution_controls SET body=jsonb_set(body,'{leaseExpiresAt}', to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE service_id=${f.serviceId}`);
    const restored = finalizationOperations(tdb.db);
    expect((await restored.forTask(f.serviceId, f.task.id))!.id).toBe(op.id);
    expect((await f.accept())!.view.taskGeneration).toBe(2);
    expect((await restored.claim({ id: op.id, owner: 'controller-after-restart', leaseSeconds: 30 }))!.view.phase).toBe('requested');
    const expired = await tdb.db.execute<{ expired: boolean }>(sql`SELECT expired FROM business_task.execution_logs WHERE task_id=${f.task.id}`);
    expect(expired[0]!.expired).toBe(true);
  });
  test('a stale worker cannot overwrite a new lease or advance without durable stop/result/receipt/reclaim evidence', async () => {
    const f = await fixture(), op = await f.accept();
    const first = (await f.store.claim({ id: op.id, owner: 'one', leaseSeconds: 30 }))!;
    expect(await f.store.claim({ id: op.id, owner: 'two', leaseSeconds: 30 })).toBeUndefined();
    await tdb.db.execute(sql`UPDATE business_task.finalizations SET lease_until=now()-interval '1 second' WHERE id=${op.id}`);
    const second = (await f.store.claim({ id: op.id, owner: 'two', leaseSeconds: 30 }))!;
    expect(second.sequence).toBe(first.sequence + 1); expect(second.view.revision).toBe(1);
    expect(await f.store.progress(leaseOf(first), { phase: 'draining', phaseState: 'running', evidence: { bindingConfirmed: true } })).toBe(false);
    await expect(f.store.progress(leaseOf(second), { phase: 'draining', phaseState: 'running' })).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f.store.progress(leaseOf(second), { phase: 'draining', phaseState: 'running', evidence: { bindingConfirmed: true } })).toBe(true);
    const third = (await f.store.claim({ id: op.id, owner: 'three', leaseSeconds: 30 }))!;
    await expect(f.store.progress(leaseOf(third), { phase: 'archiving', phaseState: 'running', evidence: { stopProofDigest: 'a'.repeat(64) } })).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.store.progress(leaseOf(third), { phase: 'completed', phaseState: 'running' })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.store.get(op.id))!.view.computeStopped).toBe(false);
  });
  test('completed is committed with the closed task only after original volume reclaim; outcome stays independent', async () => {
    const f = await fixture(), op = await f.accept({ ...f.input, outcome: 'failed' });
    const progress = async (input: FinalizationProgress) => {
      const claimed = (await f.store.claim({ id: op.id, owner: newResourceId(), leaseSeconds: 30 }))!;
      return f.store.progress(leaseOf(claimed), input);
    };
    await progress({ phase: 'draining', phaseState: 'running', evidence: { bindingConfirmed: true } });
    await progress({ phase: 'archiving', phaseState: 'running', evidence: { stopProofDigest: 'a'.repeat(64), completionProofDigest: 'b'.repeat(64) } });
    const receipt: ArchiveReceiptDto = { id: newResourceId(), taskId: f.task.id, finalizationId: op.id, taskGeneration: 2, finalizationRevision: 1, volumeUid: f.admission.volumeUid,
      manifestDigest: 'c'.repeat(64), disposition: 'empty', itemCount: 0, noArtifactsReason: '明确为空', lossActorId: null, lossReason: null, createdAt: new Date().toISOString() };
    const claim = (await f.store.claim({ id: op.id, owner: 'receipt', leaseSeconds: 30 }))!;
    await expect(f.store.progress(leaseOf(claim), { phase: 'archived', phaseState: 'running', evidence: { receipt: { ...receipt, taskId: newResourceId() as TaskId } } })).rejects.toMatchObject({ kind: 'conflict' });
    await f.store.progress(leaseOf(claim), { phase: 'archived', phaseState: 'running', evidence: { receipt } });
    await progress({ phase: 'cleaning', phaseState: 'running', evidence: { allConsumersStoppedDigest: 'd'.repeat(64), deletePermitId: newResourceId() } });
    const cleaning = (await f.store.claim({ id: op.id, owner: 'clean', leaseSeconds: 30 }))!;
    await expect(f.store.progress(leaseOf(cleaning), { phase: 'completed', phaseState: 'running', evidence: { reclaim: { proofId: newResourceId(), volumeDisposition: 'deleted', storageReclaimed: null } } })).rejects.toMatchObject({ kind: 'precondition' });
    expect(await (await f.request(`/v3/business-tasks/${f.task.id}`)).json()).toMatchObject({ state: 'finalizing', generation: 2 });
    await f.store.progress(leaseOf(cleaning), { phase: 'completed', phaseState: 'running', evidence: { reclaim: { proofId: newResourceId(), volumeDisposition: 'deleted', storageReclaimed: true } } });
    expect((await f.store.get(op.id))!.view).toMatchObject({ outcome: 'failed', phase: 'completed', computeStopped: true, artifactsReady: true, storageReclaimed: true });
    expect(await (await f.request(`/v3/business-tasks/${f.task.id}`)).json()).toMatchObject({ state: 'closed', generation: 2, quotaHeld: false });
    expect(await f.store.claim({ id: op.id, owner: 'again', leaseSeconds: 30 })).toBeUndefined();
  });
  test('normal drain requires contiguous result, consumer ACK and a matching long-lived session proof', async () => {
    const f = await fixture(), view = await (await f.request(f.path, f.commandInput)).json() as BusinessSubtaskV3Dto;
    const op = await f.accept(), completion = finalizationCompletion(tdb.db);
    const requested = (await f.store.claim({ id: op.id, owner: 'prepare', leaseSeconds: 30 }))!;
    await f.store.progress(leaseOf(requested), { phase: 'draining', phaseState: 'running', evidence: { bindingConfirmed: true } });
    const claim = (await f.store.claim({ id: op.id, owner: 'drain', leaseSeconds: 30 }))!;
    expect(await completion.page(op.id)).toEqual([{ subtaskId: view.id, executionTaskId: f.task.id, executionId: view.executionId, state: 'running', requiresSessionProof: true }]);
    await expect(completion.confirm(leaseOf(claim), [])).rejects.toMatchObject({ kind: 'conflict' });
    await expect(completion.confirm(leaseOf(claim), [{ subtaskId: view.id, proof: null }])).rejects.toMatchObject({ details: { code: 'finalization_execution_pending' } });
    const projection = drizzleExecutionProjection(tdb.db), subtasks = drizzleExecutionSubtasks(tdb.db), subtask = (await subtasks.get(f.serviceId, f.task.id, view.id))!;
    const result = { reason: 'exited' as const, exitCode: 0, durationMs: 10 }, at = new Date().toISOString();
    const receipt = { ...f.receipts.get(view.executionId)!, phase: 'finished' as const, result, lastSequence: 2 };
    const events: RunnerBusinessEvent[] = [{ sequence: 1, occurredAt: at, frame: { type: 'state', state: 'running' } }, { sequence: 2, occurredAt: at, frame: { type: 'result', result } }];
    await projection.pending(20);
    await projection.append(subtask, { taskId: f.task.id, receipt, complete: true, persistedThrough: 2, acknowledgedThrough: 2 }, events);
    const proof: ExecutionCompletionProof = { taskId: f.task.id, executionId: view.executionId, attempt: 1, incarnation: receipt.incarnation, payloadDigest: receipt.payloadDigest, lastSequence: 2, resultDigest: jsonHash(result), complete: true, persistedAt: at };
    await expect(completion.confirm(leaseOf(claim), [{ subtaskId: view.id, proof }])).rejects.toMatchObject({ details: { code: 'finalization_result_pending' } });
    await projection.consumed(view.id);
    await expect(completion.confirm(leaseOf(claim), [{ subtaskId: view.id, proof: { ...proof, attempt: 2 } }])).rejects.toMatchObject({ details: { code: 'finalization_completion_mismatch' } });
    // Raw events are not the durable finalization evidence; their absence must not erase the result proof.
    await tdb.db.execute(sql`DELETE FROM business_task.execution_events WHERE task_id=${f.task.id}`);
    const confirmed = (await completion.confirm(leaseOf(claim), [{ subtaskId: view.id, proof }]))!;
    expect(confirmed.completionScan).toMatchObject({ count: 1, complete: true });
    expect(confirmed.evidence.completionProofDigest).toHaveLength(64);
    expect(await finalizationCompletion(tdb.db).page(op.id)).toEqual([]);
    expect((await f.store.get(op.id))!.view.computeStopped).toBe(false);
  });
  test('bounded proof pages cover every never-started attempt and cannot skip an earlier page', async () => {
    const f = await fixture(); f.behavior.disconnectAfterInfo = true;
    for (let i = 0; i < 21; i++) {
      f.env.connected = true;
      const child = await (await f.request(f.path, { ...f.commandInput, requestKey: `command-${i}` })).json() as BusinessSubtaskV3Dto;
      expect((await f.request(`${f.path}/${child.id}/cancel`, { requestKey: 'never-start', expectedAttempt: 1, fence: f.fence })).status).toBe(202);
    }
    expect(f.behavior.starts).toBe(0);
    const op = await f.accept(), completion = finalizationCompletion(tdb.db);
    const requested = (await f.store.claim({ id: op.id, owner: 'prepare-pages', leaseSeconds: 30 }))!;
    await f.store.progress(leaseOf(requested), { phase: 'draining', phaseState: 'running', evidence: { bindingConfirmed: true } });
    const claim = (await f.store.claim({ id: op.id, owner: 'pages', leaseSeconds: 30 }))!;
    const first = await completion.page(op.id); expect(first).toHaveLength(20);
    await expect(completion.confirm(leaseOf(claim), first.slice(1).map((p) => ({ subtaskId: p.subtaskId, proof: null })))).rejects.toMatchObject({ kind: 'conflict' });
    const prefix = (await completion.confirm(leaseOf(claim), first.map((p) => ({ subtaskId: p.subtaskId, proof: null }))))!;
    expect(prefix.completionScan).toMatchObject({ count: 20, complete: false }); expect(prefix.evidence.completionProofDigest).toBeUndefined();
    await f.store.progress(leaseOf(claim), { phase: 'draining', phaseState: 'running' });
    const resumed = finalizationCompletion(tdb.db), second = await resumed.page(op.id); expect(second).toHaveLength(1);
    const next = (await f.store.claim({ id: op.id, owner: 'new-process', leaseSeconds: 30 }))!;
    expect(await completion.confirm(leaseOf(claim), second.map((p) => ({ subtaskId: p.subtaskId, proof: null })))).toBeUndefined();
    const complete = (await resumed.confirm(leaseOf(next), second.map((p) => ({ subtaskId: p.subtaskId, proof: null }))))!;
    expect(complete.completionScan).toMatchObject({ count: 21, complete: true }); expect(complete.evidence.completionProofDigest).toHaveLength(64);
  }, 20000);
});
