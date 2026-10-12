// Isolated real-PG owner/ending regression with controlled read-only safety/Session transport.
// The cross-owner Resources/Kubernetes chain is verified separately, not certified by this fixture.
import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { eq } from 'drizzle-orm';
import { agentStarts } from '../adapters/persistence/agentStartTable';
import { WorkloadConsumerSchema } from '@crewstation/contracts';
import { devSessionMigrations } from '../wiring';
import { developmentCleanupFixture } from './developmentCleanupFixture';
import { developmentCleanupParticipant } from '../application/development/cleanup';
import { requestDevelopmentEnding } from '../application/development/ending';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 unbound/no-grant original ending', () => {
  let db: TestDatabase;
  afterEach(async () => { await db?.drop(); });
  test('closed original owner and absent Session permit only stopping, with unknown numeric usage', async () => {
    db = await createTestDatabase([devSessionMigrations]);
    const f = await developmentCleanupFixture(db.db, false);
    const consumer = WorkloadConsumerSchema.parse({ id: f.input.consumerId, resourceId: f.child.id, taskId: f.workspace.id,
      revision: 1, namespace: 'cs-qa', podName: f.child.podName, volumeUid: crypto.randomUUID(), purpose: 'agent', finalization: null });
    let lookups = 0;
    const deps = { ...f.deps, environments: f.environmentPort, session: { ...f.session, lookupDevelopmentUsage: async () => {
      lookups++; return { version: 1 as const, kind: 'absent' as const, runtimeTaskId: f.child.id };
    } }, workloadSafety: { get: async () => ({ consumer, admissionClosed: true, startPermit: null, stopProof: null }), admissionClosed: async () => true } };
    const participant = developmentCleanupParticipant(deps);
    const result = await participant.advance(f.input);
    expect(result).toMatchObject({ kind: 'permitted', evidence: { version: 2, kind: 'unbound-no-grant', phase: 'stopping', numericState: 'unknown', stopProof: null } });
    expect(lookups).toBeGreaterThan(0);
    expect((await f.owner.get(f.child.id))?.binding).toBeNull();
    expect((await f.owner.get(f.child.id))?.closeReason).toBe('cancelled');
    expect(await f.starts.findByExecution(f.child.id)).toMatchObject({ state: 'ended' });
    expect((await db.db.select().from(agentStarts).where(eq(agentStarts.executionTaskId, f.child.id)))[0]).toMatchObject({ state: 'ended', logicalEnding: true });
    expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-stop', logicalResult: null, stop: null, closure: null, actualEndedAt: null });
    expect(f.calls).toEqual([]); expect(f.registrations).toEqual([]);
  });
  test.each(['error', 'completed'] as const)('an unbound original %s reason closes admission without a fabricated terminal receipt', async (firstReason) => {
    db = await createTestDatabase([devSessionMigrations]);
    const f = await developmentCleanupFixture(db.db, false);
    await f.owner.close(f.child.id, firstReason);
    await f.starts.update({ ...f.start, state: 'ended', endedAt: f.endingControl.now, finalized: false });
    const originalOwner = await f.owner.get(f.child.id);
    const [originalStart] = await db.db.select().from(agentStarts).where(eq(agentStarts.executionTaskId, f.child.id));
    if (!originalStart) throw new Error('original AgentStart row missing');
    expect(originalStart).toMatchObject({ state: 'ended', logicalEnding: false, cancelled: false, finalized: false, dispatchedAt: null, endedAt: f.endingControl.now });
    expect(await requestDevelopmentEnding(f.deps, f.child.id, firstReason)).toEqual({ kind: 'waiting', reason: 'terminal-receipt-unavailable' });
    expect(await f.store.get(f.child.id)).toBeUndefined();
    const consumer = WorkloadConsumerSchema.parse({ id: f.input.consumerId, resourceId: f.child.id, taskId: f.workspace.id,
      revision: 1, namespace: 'cs-qa', podName: f.child.podName, volumeUid: crypto.randomUUID(), purpose: 'agent', finalization: null });
    let lookups = 0;
    const deps = { ...f.deps, environments: f.environmentPort, session: { ...f.session, lookupDevelopmentUsage: async () => {
      lookups++; return { version: 1 as const, kind: 'absent' as const, runtimeTaskId: f.child.id };
    } }, workloadSafety: { get: async () => ({ consumer, admissionClosed: true, startPermit: null, stopProof: null }), admissionClosed: async () => true } };
    const participant = developmentCleanupParticipant(deps);
    const result = await participant.advance(f.input);
    expect(result).toMatchObject({ kind: 'permitted', evidence: { version: 2, kind: 'unbound-no-grant', phase: 'stopping', numericState: 'unknown', stopProof: null,
      owner: { firstReason, payloadDigest: originalOwner!.payloadDigest, acceptedAt: originalOwner!.price.acceptedAt } } });
    expect(lookups).toBeGreaterThan(0);
    expect(await f.owner.get(f.child.id)).toEqual(originalOwner);
    const [closedStart] = await db.db.select().from(agentStarts).where(eq(agentStarts.executionTaskId, f.child.id));
    if (!closedStart) throw new Error('original AgentStart row missing');
    expect(closedStart).toMatchObject({ logicalEnding: true });
    expect({ ...closedStart, logicalEnding: originalStart.logicalEnding }).toEqual(originalStart);
    const ending = await f.store.get(f.child.id);
    expect(ending).toMatchObject({ firstReason, stage: 'awaiting-stop', logicalResult: null, stop: null, closure: null, actualEndedAt: null, prestartClosure: null });
    expect(await participant.advance(f.input)).toEqual(result);
    expect(await f.store.get(f.child.id)).toEqual(ending);
    expect(await f.owner.get(f.child.id)).toEqual(originalOwner);
    await expect(f.owner.bind(f.child.id, f.info)).rejects.toThrow();
    expect(f.calls).toEqual([]); expect(f.registrations).toEqual([]); expect(f.drains).toEqual([]);
  });
});

describe.skipIf(!available)('RFC-034 real original close/bind transaction competition', () => {
  test('the same owner lock makes null-binding close and late binding mutually exclusive', async () => {
    const database = await createTestDatabase([devSessionMigrations]);
    try {
      const f = await developmentCleanupFixture(database.db, false);
      const result = await Promise.allSettled([
        f.store.request({ executionTaskId: f.child.id, expectedRegistration: null, reason: 'cancelled', observedAt: f.endingControl.now }),
        f.owner.bind(f.child.id, f.info),
      ]);
      expect(result.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
      const owner = (await f.owner.get(f.child.id))!;
      if (result[0]!.status === 'fulfilled') {
        expect(owner.binding).toBeNull(); expect(owner.closeReason).toBe('cancelled');
        expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-stop', logicalResult: null, closure: null, stop: null });
        expect((await f.starts.findByExecution(f.child.id))?.state).toBe('ended');
      } else {
        expect(owner.binding?.podUid).toBe(f.info.podUid); expect(owner.closeReason).toBeNull();
        expect(await f.store.get(f.child.id)).toBeUndefined();
      }
      expect(f.calls).toEqual([]); expect(f.registrations).toEqual([]);
    } finally { await database.drop(); }
  });
});
