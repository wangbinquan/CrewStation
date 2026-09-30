import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { advanceDevelopmentEnding, recoverDevelopmentEndings, requestDevelopmentEnding } from '../application/development/ending';
import type { DevelopmentEndingSession } from '../ports/developmentEnding';
import { developmentEndingStore } from '../adapters/persistence/ending/store';
import { devSessionMigrations } from '../wiring';
import { developmentEndingFixture } from './developmentEndingFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });

describe.skipIf(!available)('结束原键登记恢复与停止/数字排空', () => {
  test('bind committed plus failed registration then cancellation and restart restores registration before stop and drain', async () => {
    const f = await developmentEndingFixture(database.db);
    f.control.registerFailure = true;
    expect((await requestDevelopmentEnding(f.deps, f.child.id, 'cancelled')).kind).toBe('ending');
    expect(await advanceDevelopmentEnding(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'retry' });
    expect(f.calls).toHaveLength(0); expect(f.stored.size).toBe(0);
    f.control.registerFailure = false; f.controls.priceFailure = new Error('current prices are unavailable');
    const result = await advanceDevelopmentEnding({ ...f.deps, store: developmentEndingStore(database.db, f.deps.clock) }, f.child.id);
    expect(result.kind).toBe('ending');
    if (result.kind === 'ending') expect(result.job).toMatchObject({ stage: 'evidence-complete', firstReason: 'cancelled', logicalResult: 'completed', actualEndedAt: null });
    const original = (await f.owner.get(f.child.id))!;
    expect(f.calls).toHaveLength(1); expect(f.calls[0]).toMatchObject({ type: 'stopDevelopmentAgent', podUid: original.binding!.podUid, admission: { key: original.binding!.key, digestNonce: original.digestNonce, intent: original.intent } });
    expect(f.drains).toEqual(['cancelled']); expect(f.controls.priceCalls).toBe(1); expect(f.control.materialCalls).toBe(0);
  });
  test('persistent finished after ordinary terminal/ACK loss recovers even for finalized Agent and preserves original request reason', async () => {
    const f = await developmentEndingFixture(database.db);
    await f.owner.close(f.child.id, 'workspace-released'); await f.starts.update({ ...f.start, state: 'ended', finalized: true });
    const receipt = await f.setReceipt({ phase: 'finished', result: 'completed', finalThrough: 0 }, true);
    f.control.connected = false; f.control.capabilities = undefined; f.control.info = { ...f.info, incarnation: crypto.randomUUID(), receipt };
    const recovered = await recoverDevelopmentEndings(f.deps);
    expect(recovered.recovered).toBeGreaterThan(0); expect(await f.store.get(f.child.id)).toMatchObject({ firstReason: 'workspace-released', logicalResult: 'completed', actualEndedAt: null });
    expect(f.calls).toHaveLength(0); expect(f.controls.priceCalls).toBe(1);
  });
  test('existing Session drain reason is reused independently of the owner first reason', async () => {
    const f = await developmentEndingFixture(database.db); await f.request('workspace-released');
    const registration = (await f.owner.get(f.child.id))!.binding!, stored = await f.session.registerDevelopmentUsage(registration);
    f.stored.get(f.child.id)!.drainReason = 'cancelled';
    expect(stored.drainReason).toBeNull();
    const result = await advanceDevelopmentEnding(f.deps, f.child.id);
    expect(result.kind).toBe('ending'); expect(f.drains).toEqual(['cancelled']);
    expect(await f.store.get(f.child.id)).toMatchObject({ firstReason: 'workspace-released', stage: 'evidence-complete' });
  });
  test('ordinary interrupted finished or stopping never supplies a physical stop proof, even after a durable digital closure', async () => {
    const f = await developmentEndingFixture(database.db); await f.request(); f.endingControl.stopState = 'unknown'; f.endingControl.closure = 'interrupted';
    let result = await advanceDevelopmentEnding(f.deps, f.child.id);
    expect(result.kind).toBe('ending'); expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-stop', stop: null, closure: { status: 'interrupted' }, actualEndedAt: null });
    const running = await developmentEndingFixture(database.db); await running.request(); running.endingControl.stopState = 'stopping'; running.endingControl.closure = 'pending';
    result = await advanceDevelopmentEnding(running.deps, running.child.id);
    expect(result.kind).toBe('ending'); expect(await running.store.get(running.child.id)).toMatchObject({ stage: 'awaiting-stop', logicalResult: null, stop: null, closure: null });
  });
  test('physical stop with M8/N10 still waits for the readable digital tail rather than claiming complete', async () => {
    const f = await developmentEndingFixture(database.db); await f.request(); Object.assign(f.endingControl, { sequence: 10, copied: 8, closure: 'pending' });
    await advanceDevelopmentEnding(f.deps, f.child.id);
    expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-closure', stop: { state: 'finished' }, closure: null, actualEndedAt: null });
    f.endingControl.copied = 10; f.endingControl.closure = 'complete'; f.endingControl.now = '2026-09-30T00:20:01.000Z';
    const result = await advanceDevelopmentEnding(f.deps, f.child.id);
    expect(result.kind).toBe('ending'); expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'evidence-complete', closure: { persistedThrough: 10, reportedThrough: 10 } });
    expect(await advanceDevelopmentEnding(f.deps, f.child.id)).toEqual({ kind: 'busy' });
  });
  test('prevented original admission has an actual cancellation result and zero-copy closure, with no model material', async () => {
    const f = await developmentEndingFixture(database.db); await f.request(); f.endingControl.stopState = 'prevented';
    await advanceDevelopmentEnding(f.deps, f.child.id);
    expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'evidence-complete', logicalResult: 'cancelled', stop: { state: 'prevented' } });
    expect(f.control.materialCalls).toBe(0);
  });
  test('unbound close stays waiting and never rebinds, sends a model, or invents a zero digital stream', async () => {
    const f = await developmentEndingFixture(database.db, { bound: false }); await requestDevelopmentEnding(f.deps, f.child.id, 'cancelled');
    expect(await advanceDevelopmentEnding(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'unbound' });
    expect(f.registrations).toHaveLength(0); expect(f.calls).toHaveLength(0);
    expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-stop', logicalResult: null, stop: null, closure: null });
    await expect(f.owner.bind(f.child.id, f.info)).rejects.toMatchObject({ kind: 'precondition' });
    const legacy = await developmentEndingFixture(database.db, { selected: false });
    expect(await requestDevelopmentEnding(legacy.deps, legacy.child.id, 'cancelled')).toEqual({ kind: 'legacy' });
  });
  test('registration/key/Pod/profile conflicts or temporary stop/drain errors produce no loss and no exit grant', async () => {
    const f = await developmentEndingFixture(database.db); await f.request();
    const registration = (await f.owner.get(f.child.id))!.binding!, original = await f.session.registerDevelopmentUsage(registration);
    for (const patch of [{ podUid: 'other-pod' }, { key: { ...registration.key, incarnation: crypto.randomUUID() } }, { profileRevision: 99 }, { identity: { ...registration.identity, agentId: crypto.randomUUID() } }]) {
      f.control.badStored = { ...original, registration: { ...registration, ...patch } };
      expect(await advanceDevelopmentEnding(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'retry' });
    }
    f.control.badStored = undefined; expect(f.calls).toHaveLength(0);
    f.endingControl.stopFailure = true; f.endingControl.closure = 'pending'; await advanceDevelopmentEnding(f.deps, f.child.id);
    expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-stop', stop: null, closure: null });
    f.endingControl.stopFailure = false; f.endingControl.drainFailure = true;
    expect(await advanceDevelopmentEnding(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'retry' });
    expect(f.stored.get(f.child.id)!.loss).toBeNull();
  });
  test('network time passing the lease deadline rejects evidence using the actual post-I/O clock', async () => {
    const f = await developmentEndingFixture(database.db); await f.request();
    f.endingControl.onStop = async () => { f.endingControl.now = '2026-09-30T00:20:31.000Z'; };
    expect(await advanceDevelopmentEnding(f.deps, f.child.id)).toEqual({ kind: 'waiting', reason: 'stale-lease' });
    expect(await f.store.get(f.child.id)).toMatchObject({ stage: 'awaiting-stop', stop: null, closure: null });
  });
  test('bounded owner scanning rotates past running executions and is durable across another store instance', async () => {
    const isolated = await createTestDatabase([devSessionMigrations]);
    try {
      const all: Awaited<ReturnType<typeof developmentEndingFixture>>[] = [];
      for (let i = 0; i < 35; i++) all.push(await developmentEndingFixture(isolated.db));
      const first = await all[0]!.store.takeRecoveryOwners('2026-09-30T01:00:00.000Z'); expect(first).toHaveLength(32);
      const other = developmentEndingStore(isolated.db), next = await other.takeRecoveryOwners('2026-09-30T01:00:01.000Z');
      expect(next).toHaveLength(32); expect(next.slice(0, 3).every((id) => !first.includes(id))).toBe(true);
      for (const id of next.slice(0, 3)) {
        const f = all.find((item) => item.child.id === id)!;
        await f.starts.update({ ...f.start, state: 'ended', finalized: true }); await f.setReceipt({ phase: 'finished', result: 'completed', finalThrough: 0 }, true);
      }
      const deps = { ...all[0]!.deps, store: other,
        session: { ...all[0]!.session, registerDevelopmentUsage: async (r: Parameters<DevelopmentEndingSession['registerDevelopmentUsage']>[0]) => all.find((f) => f.child.id === r.runtimeTaskId)!.session.registerDevelopmentUsage(r) } };
      all[0]!.endingControl.now = '2026-09-30T01:00:02.000Z'; const result = await recoverDevelopmentEndings(deps);
      all[0]!.endingControl.now = '2026-09-30T01:00:03.000Z'; const retry = await recoverDevelopmentEndings(deps);
      expect(result.checked).toBe(32); expect(retry.checked).toBeLessThanOrEqual(32); expect(result.recovered + retry.recovered).toBe(3);
    } finally { await isolated.drop(); }
  });
});
