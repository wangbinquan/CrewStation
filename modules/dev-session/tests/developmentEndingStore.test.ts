import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { newResourceId } from '@crewstation/kernel';
import type { TaskId } from '@crewstation/contracts';
import { developmentEndingStore } from '../adapters/persistence/ending/store';
import { developmentUsageOwnerStore } from '../adapters/persistence/developmentUsage';
import { devSessionMigrations } from '../wiring';
import { developmentEndingFixture } from './developmentEndingFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

describe.skipIf(!available)('原执行持久结束作业与租约', () => {
  test('concurrent requests keep exactly one first reason and observation, closing binding in the same commit', async () => {
    const f = await developmentEndingFixture(database.db), frozen = await f.owner.get(f.child.id), reg = frozen!.binding;
    const [a, b] = await Promise.all([
      f.store.request({ executionTaskId: f.child.id, expectedRegistration: reg, reason: 'cancelled', observedAt: f.endingControl.now }),
      f.store.request({ executionTaskId: f.child.id, expectedRegistration: reg, reason: 'workspace-released', observedAt: '2026-09-30T00:21:00.000Z' }),
    ]);
    expect(a).toEqual(b); expect(a.logicalResult).toBeNull(); expect(a.actualEndedAt).toBeNull(); expect(a.version).toBe(1);
    const restored = developmentEndingStore(database.db), owner = await developmentUsageOwnerStore(database.db).get(f.child.id);
    expect(await restored.get(f.child.id)).toEqual(a); expect(owner).toMatchObject({ closeReason: a.firstReason, binding: reg, price: frozen!.price, digestNonce: frozen!.digestNonce });
    expect(await f.starts.get(f.start.agentId)).toMatchObject({ state: 'ended', finalized: false });
    expect(await restored.get(newResourceId() as TaskId)).toBeUndefined();
  });
  test('actual completed result is independent of an earlier cancellation and retains an unknown end time', async () => {
    const f = await developmentEndingFixture(database.db), first = await f.request();
    const receipt = await f.setReceipt({ phase: 'finished', result: 'completed', finalThrough: 0 }, true);
    const next = await f.store.request({ executionTaskId: f.child.id, expectedRegistration: (await f.owner.get(f.child.id))!.binding, reason: 'completed', observedAt: '2026-09-30T01:00:00.000Z', receipt });
    expect(next).toMatchObject({ firstReason: 'cancelled', logicalResult: 'completed', actualEndedAt: null, observedAt: first.observedAt, version: 2 });
    const changed = { ...receipt, result: 'error' as const };
    await expect(f.store.request({ executionTaskId: f.child.id, expectedRegistration: (await f.owner.get(f.child.id))!.binding, reason: 'error', observedAt: f.endingControl.now, receipt: changed })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.store.get(f.child.id)).toEqual(next);
  });
  test('already finalized original execution still gets its durable job; ordinary timestamps are not reused as actual evidence', async () => {
    const f = await developmentEndingFixture(database.db);
    await f.starts.update({ ...f.start, state: 'ended', finalized: true, endedAt: '2026-09-30T00:15:00.000Z' });
    const job = await f.request('workspace-released');
    expect(job.actualEndedAt).toBeNull(); expect((await f.starts.listUnfinalized(undefined, 500)).some((s) => s.agentId === f.start.agentId)).toBe(false);
    expect((await f.store.listPending(f.endingControl.now))).toContain(f.child.id);
    expect(await f.starts.get(f.start.agentId)).toMatchObject({ state: 'ended', finalized: true, endedAt: '2026-09-30T00:15:00.000Z' });
  });
  test('wrong original registration or unsupported owner fails without creating a job or closing a fresh owner', async () => {
    const f = await developmentEndingFixture(database.db), registration = (await f.owner.get(f.child.id))!.binding!;
    await expect(f.store.request({ executionTaskId: f.child.id, expectedRegistration: { ...registration, podUid: 'other-pod' }, reason: 'cancelled', observedAt: f.endingControl.now })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await f.store.get(f.child.id)).toBeUndefined(); expect((await f.owner.get(f.child.id))!.closeReason).toBeNull();
    const legacy = await developmentEndingFixture(database.db, { bound: false }); await legacy.owner.unsupported(legacy.child.id);
    await expect(legacy.request()).rejects.toMatchObject({ kind: 'precondition' }); expect(await legacy.store.get(legacy.child.id)).toBeUndefined();
    await expect(f.store.claim(newResourceId() as TaskId, f.endingControl.now)).rejects.toMatchObject({ kind: 'not_found' });
    for (const reason of ['completed', 'error', 'forced-release', 'environment-lost'] as const) await expect(f.request(reason)).rejects.toBeDefined();
    expect(await f.store.get(f.child.id)).toBeUndefined();
  });
  test('two instances claim only one lease; expired fencing and changed evidence versions reject stale writes', async () => {
    const f = await developmentEndingFixture(database.db); await f.request();
    const other = developmentEndingStore(database.db, f.deps.clock);
    const claims = await Promise.all([f.store.claim(f.child.id, f.endingControl.now), other.claim(f.child.id, f.endingControl.now)]);
    expect(claims.filter(Boolean)).toHaveLength(1); const first = claims.find(Boolean)!;
    f.endingControl.now = '2026-09-30T00:20:29.000Z'; expect(await other.claim(f.child.id, f.endingControl.now)).toBeUndefined();
    f.endingControl.now = '2026-09-30T00:20:31.000Z'; const second = (await other.claim(f.child.id, '2026-09-30T00:20:31.000Z'))!;
    expect(second.job.fence).toBe(first.job.fence + 1); expect(await f.store.retry(first, '2026-09-30T00:20:31.000Z')).toBe(false);
    const receipt = await f.setReceipt({ phase: 'finished', result: 'completed', finalThrough: 0 }, true);
    const updated = await f.store.request({ executionTaskId: f.child.id, expectedRegistration: second.registration, reason: 'completed', observedAt: '2026-09-30T00:20:32.000Z', receipt });
    expect(updated.version).toBe(second.job.version + 1); expect(await f.store.retry(second, '2026-09-30T00:20:32.000Z')).toBe(false);
    const stored = await f.session.registerDevelopmentUsage(second.registration!);
    expect(await f.store.commit(second, { observedAt: '2026-09-30T00:20:32.000Z', stored, stop: null })).toBeUndefined();
    expect((await other.get(f.child.id))!.logicalResult).toBe('completed');
  });
  test('pending attempts rotate durably in fixed batches across another instance', async () => {
    // Separate DB avoids earlier tests determining the bounded cohort.
    const isolated = await createTestDatabase([devSessionMigrations]);
    try {
      const fixtures = [];
      for (let i = 0; i < 35; i++) { const f = await developmentEndingFixture(isolated.db); await f.request(); fixtures.push(f); }
      const store = developmentEndingStore(isolated.db, { now: () => new Date('2026-09-30T01:00:00.001Z') }), first = await store.listPending('2026-09-30T01:00:00.000Z');
      expect(first).toHaveLength(32);
      for (const id of first) { const lease = (await store.claim(id, '2026-09-30T01:00:00.000Z'))!; await store.retry(lease, '2026-09-30T01:00:00.001Z'); }
      const next = await developmentEndingStore(isolated.db).listPending('2026-09-30T01:00:01.000Z');
      expect(next).toHaveLength(32); expect(next.slice(0, 3).every((id) => !first.includes(id))).toBe(true);
      expect(fixtures.every((f) => f.control.materialCalls === 0)).toBe(true);
    } finally { await isolated.drop(); }
  });
});
