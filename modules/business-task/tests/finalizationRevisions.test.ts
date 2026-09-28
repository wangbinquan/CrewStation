import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type { ReviseBusinessArchive } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { executionOperations } from '../adapters/persistence/executionTables';
import { finalizationOperations } from '../adapters/persistence/finalization/repository';
import { finalizationLease } from '../application/finalization/progress';
import { finalizationRevisions } from '../application/finalization/revisions';
import type { FinalizationPreparation } from '../ports/storage/preparation';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('durable manifest revision outbox', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(prepared = true) {
    const f = await executionCommandFixture(tdb.db), store = finalizationOperations(tdb.db);
    const parent = (await tdb.db.select().from(executionOperations).where(eq(executionOperations.serviceId, f.serviceId)))[0]!;
    await tdb.db.update(executionOperations).set({ intent: { ...parent.intent, task: { ...parent.intent.task, completionPolicy: 'archive-and-delete' } } }).where(eq(executionOperations.id, parent.id));
    const authorization = { fence: f.fence, source: { ...f.sources.get('trusted')!.source, role: 'prod' as const } };
    const op = await store.accept(f.serviceId, f.task.id, { requestKey: 'finish', expectedGeneration: 1, outcome: 'succeeded', archive: { noArtifactsReason: 'old' }, fence: f.fence }, { spaceId: newResourceId(), volumeUid: newResourceId(), authorization });
    if (prepared) {
      const claim = (await store.claim({ id: op.id, owner: 'prepare', leaseSeconds: 30 }))!;
      await store.progress(finalizationLease(claim), { phase: 'draining', phaseState: 'pending', evidence: { bindingConfirmed: true } });
    }
    const input: ReviseBusinessArchive = { expectedGeneration: 2, expectedRevision: 1, requestKey: 'change', archive: { noArtifactsReason: 'corrected' }, reason: 'explicit correction', confirmDiscard: false, fence: f.fence };
    const behavior = { loseReply: false, replyLost: false, receiptWon: false, stopped: false, reject: false }, changes: string[] = [], stops: number[] = [];
    const ports: FinalizationPreparation = {
      archive: { bind: async () => { throw new Error('unused'); }, commitArchive: async () => { throw new Error('unused'); }, observe: async () => true,
        revise: async (id) => { changes.push(id); if (behavior.reject) throw precondition('confirm discard', { code: 'archive_discard_confirmation_required' });
          if (behavior.loseReply && !behavior.replyLost) { behavior.replyLost = true; throw new Error('committed reply lost'); }
          return { applied: !behavior.receiptWon, binding: { revision: behavior.receiptWon ? 1 : 2, receipt: null } }; },
      },
      runtime: { freezeBusinessStorage: async () => {}, stopBusinessStorage: async () => { throw new Error('unused'); }, archiveExecution: { ensure: async () => {}, stop: async (input) => { stops.push(input.revision); return behavior.stopped; } } },
    };
    const due = () => tdb.db.execute(sql`UPDATE business_task.finalizations SET next_attempt_at=now()-interval '1 second' WHERE id=${op.id}`);
    return { ...f, store, op, input, ports, due, changes, behavior, stops, authorization, revise: () => store.revise(f.serviceId, f.task.id, input, authorization), worker: () => finalizationRevisions(finalizationOperations(tdb.db), ports)(op.id) };
  }
  test('revision invalidates old workers, replays data after a lost reply and awaits real helper stop before publishing R2', async () => {
    const f = await fixture(), old = (await f.store.claim({ id: f.op.id, owner: 'old', leaseSeconds: 30 }))!;
    const [a, b] = await Promise.all([f.revise(), f.revise()]); expect(a.id).toBe(b.id);
    expect(await f.make().module.api.acceptedArchiveRevision(a.id)).toMatchObject({ id: a.id, finalizationId: f.op.id, actor: { podUid: 'pod-one' } });
    expect(await f.store.progress(finalizationLease(old), { phase: 'draining', phaseState: 'pending' })).toBe(false);
    expect(await f.store.claim({ id: f.op.id, owner: 'normal', leaseSeconds: 30 })).toBeUndefined();
    f.behavior.loseReply = true; await f.worker();
    expect((await f.store.get(f.op.id))!.view).toMatchObject({ revision: 1, phaseState: 'revising' }); expect(f.stops).toEqual([]);
    await f.due(); await f.worker(); expect(f.stops).toEqual([1]); expect((await f.store.get(f.op.id))!.view.revision).toBe(1);
    f.behavior.stopped = true; await f.due(); await f.worker();
    expect(new Set(f.changes)).toEqual(new Set([a.id]));
    expect((await f.store.get(f.op.id))!.view).toMatchObject({ revision: 2, phase: 'requested', phaseState: 'pending', taskGeneration: 2, computeStopped: false });
    expect((await f.revise()).state).toBe('applied'); expect(await f.worker()).toBe(0);
    expect(await f.make().module.api.acceptedArchiveRevision(a.id)).toBeUndefined();
    await expect(f.store.revise(f.serviceId, f.task.id, { ...f.input, reason: 'changed' }, f.authorization)).rejects.toMatchObject({ details: { code: 'idempotency_conflict' } });
  });
  test('old receipt wins without changing revision; rejected removal leaves the original archive available', async () => {
    for (const reject of [false, true]) {
      const f = await fixture(); f.behavior.receiptWon = !reject; f.behavior.reject = reject;
      const http = f.make({ finalizationPreparation: f.ports }), response = await http.request(`/v3/business-tasks/${f.task.id}/finalization/archive`, f.input);
      expect(response.status).toBe(409);
      expect((await response.json()).details.code).toBe(reject ? 'archive_discard_confirmation_required' : 'archive_receipt_already_committed');
      const current = (await f.store.get(f.op.id))!; expect(current.view).toMatchObject({ revision: 1, phaseState: 'pending' });
      expect(current.archive).toEqual({ noArtifactsReason: 'old' }); expect(f.stops).toEqual([]);
      expect((await f.revise()).state).toBe('rejected');
    }
  });
  test('wrong generations and fences cannot persist a revision or pause ordinary finalization work', async () => {
    const f = await fixture();
    await expect(f.store.revise(f.serviceId, f.task.id, f.input, { source: f.authorization.source })).rejects.toThrow();
    await expect(f.store.revise(f.serviceId, f.task.id, { ...f.input, expectedGeneration: 1 }, f.authorization)).rejects.toThrow();
    expect((await f.store.get(f.op.id))!.view.phaseState).toBe('pending');
    expect((await f.make().request(`/v3/business-tasks/${f.task.id}/finalization/archive`, f.input)).status).toBe(412);
  });
  test('a requested operation can repair an unusable plan before the first data binding handshake', async () => {
    const f = await fixture(false); f.behavior.stopped = true;
    const revision = await f.revise(); await f.worker();
    expect((await f.store.revision(revision.id))?.state).toBe('applied');
    expect((await f.store.get(f.op.id))?.view).toMatchObject({ phase: 'requested', revision: 2, phaseState: 'pending' });
  });
});
