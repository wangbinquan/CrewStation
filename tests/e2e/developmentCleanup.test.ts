// RFC-034: actual SQLite -> Session PG -> owner ending -> Task lease -> Controller stop.
// These tests do not claim deployed platform/browser or real model acceptance.
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '../../packages/testkit';
import { Resources } from '../../packages/k8s';
import { developmentCleanupChain } from './developmentCleanupFixture';
import type { DevelopmentCleanupChain } from './developmentCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 actual bound development digital and physical cleanup chain', () => {
  let f: DevelopmentCleanupChain;
  afterEach(async () => { await f?.close(); });
  for (const mode of ['ledger', 'native'] as const) {
    test(mode + ': PG copies precede Runner ACK and physical reclaim, surviving both original journal loss and Session restart', async () => {
      f = await developmentCleanupChain(mode); const token = f.env.runnerTokenHash;
      await f.finalize();
      const completed = await f.load(f.env.id), copy = await f.copy.session.api.getDevelopmentUsage(f.env.id, f.registration.key);
      expect(completed).toMatchObject({ state: 'released', connected: false, native: { state: 'finished', developmentCleanup: { owner: { priceBookRevision: 3 }, closure: { status: 'complete', persistedThrough: 3, reportedThrough: 3, tailUnknown: false } } } });
      expect(completed.runnerTokenHash).not.toBe(token); expect(copy).toMatchObject({ persistedThrough: 3, runnerAcknowledgedThrough: 3, sourceAcknowledgedThrough: 0 });
      expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
      expect(await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace)).toBeUndefined();
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
      f.closeJournal(); f.copy.restart();
      expect(await f.copy.session.api.getDevelopmentUsage(f.env.id, f.registration.key)).toEqual(copy);
      const page = await f.copy.session.api.nextDevelopmentUsageSource(); expect(page?.through).toBe(3);
      expect(page?.events[0]?.capture.measurements[0]?.usage.input).toBe('9007199254740993');
      expect(JSON.stringify(completed.native?.developmentCleanup)).not.toContain('owner-private-prompt');
    }, 15000);
  }
  for (const mode of ['ledger', 'native'] as const) for (const historical of [false, true]) {
    test(mode + (historical ? ' historical unmarked' : ' new marker') + ': generic deletion waits for actual SQLite to Session PG before accepting the original object', async () => {
      f = await developmentCleanupChain(mode, 3, true, historical);
      const target = { kind: 'Pod' as const, namespace: f.env.namespace, name: f.env.podName, uid: f.env.native!.podUid!, operation: 'delete' as const };
      f.copy.control.copy = false; await f.runNative();
      expect(await f.runtime.api.inspectDevelopmentRemoval(target)).toMatchObject({ kind: 'waiting' });
      expect(f.physical.state.deleteRequests).toEqual([]);
      expect(await f.copy.session.api.getDevelopmentUsage(f.env.id, f.registration.key)).toMatchObject({ persistedThrough: 0, closure: null });
      f.copy.control.copy = true; await f.runNative();
      expect(await f.copy.session.api.getDevelopmentUsage(f.env.id, f.registration.key)).toMatchObject({ persistedThrough: 3, runnerAcknowledgedThrough: 3 });
      expect(await f.runtime.api.inspectDevelopmentRemoval(target)).toMatchObject({ kind: 'permitted' });
      const runner = (await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace))!;
      expect(await f.runtime.api.inspectDevelopmentRemoval({ ...target, kind: 'Secret', name: runner.metadata.name, uid: runner.metadata.uid! })).toMatchObject({ kind: 'waiting' });
      const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start();
      await removed; await controller.reconciled(); await controller.observer.stop();
      expect(await f.runtime.api.inspectDevelopmentRemoval({ ...target, kind: 'Secret', name: runner.metadata.name, uid: runner.metadata.uid! })).toMatchObject({ kind: 'permitted' });
      await f.runNative(); await f.settle();
      expect((await f.load(f.env.id)).native?.developmentRemovalSeal).toMatchObject({ originalRunnerTokenHash: f.env.runnerTokenHash });
      expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
    }, 15000);
  }
  test('uncopied final numeric tail holds original credentials and occupied quota, then resumes without replacing the owner', async () => {
    f = await developmentCleanupChain(); f.copy.control.copy = false;
    await f.runNative(); const pending = await f.load(f.env.id);
    expect(pending).toMatchObject({ connected: true, native: { state: 'cleaning' } }); expect(pending.runnerTokenHash).toBe(f.env.runnerTokenHash);
    expect(pending.native?.developmentCleanup).toBeUndefined(); expect(f.physical.state.deleteRequests).toEqual([]);
    expect(await f.copy.session.api.getDevelopmentUsage(f.env.id, f.registration.key)).toMatchObject({ persistedThrough: 0, closure: null });
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    f.copy.control.copy = true; await f.finalize();
    expect((await f.owner.get(f.env.id))?.binding).toEqual(f.registration); expect(f.controls.priceCalls).toBe(1);
  }, 15000);
  for (const fault of ['loseStopAck', 'loseDrainAck', 'loseRunnerAck', 'loseEndingAck'] as const) {
    test(fault + ': lost reply after durable change cannot reclaim before independent stop and PG evidence, and replay keeps original prices', async () => {
      f = await developmentCleanupChain(); f.copy.control[fault] = true;
      await f.runNative();
      // A committed ending may immediately be re-read; a missing independent stop/copy must wait.
      if (fault !== 'loseEndingAck') expect(f.physical.state.deleteRequests).toEqual([]);
      expect((await f.owner.get(f.env.id))?.binding).toEqual(f.registration); f.controls.priceRevision = 9;
      if (!f.physical.state.deleteRequests.length) await f.finalize();
      else {
        const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start(); await removed; await controller.reconciled(); await controller.observer.stop();
        await f.runNative(); await f.settle();
      }
      expect((await f.load(f.env.id)).native?.developmentCleanup?.owner.priceBookRevision).toBe(3);
      expect((await f.starts.findByExecution(f.env.id))?.state).toBe('ended'); expect(f.controls.priceCalls).toBe(1);
      expect((await f.store.get(f.env.id))?.stage).toBe('evidence-complete');
    }, 15000);
  }
  test('known N=10 and copied M=5 keep the exact missing tail while independent stop still comes from the original journal', async () => {
    f = await developmentCleanupChain('ledger', 10);
    await f.copy.session.api.registerDevelopmentUsage(f.registration);
    await f.copy.store.ingest(f.env.id, f.journal.info(f.registration.key).receipt!, f.journal.read(f.registration.key, 0, 5));
    f.copy.control.recordsLost = true; await f.finalize();
    expect((await f.load(f.env.id)).native?.developmentCleanup).toMatchObject({ stop: { state: 'finished' }, closure: { status: 'interrupted', persistedThrough: 5, reportedThrough: 10, missingAfter: 5, missingThrough: 10, tailUnknown: true, reason: 'journal-unavailable' } });
    const page = await f.copy.session.api.nextDevelopmentUsageSource(); expect(page?.through).toBe(5); expect(page?.events).toHaveLength(5);
  }, 15000);
  test('copied running records do not prove a stopped model; the original binding remains until a terminal receipt is observed', async () => {
    f = await developmentCleanupChain(); f.copy.control.autoStop = false; await f.runNative();
    expect(f.physical.state.deleteRequests).toEqual([]); expect((await f.load(f.env.id)).native?.developmentCleanup).toBeUndefined();
    expect(await f.copy.session.api.getDevelopmentUsage(f.env.id, f.registration.key)).toMatchObject({ persistedThrough: 3, runnerAcknowledgedThrough: 3, closure: null });
    expect((await f.store.get(f.env.id))?.stop).toBeNull(); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    f.copy.control.autoStop = true; await f.finalize();
  }, 15000);
  test('source ACK progress and later pricing do not change the durable original cleanup permit', async () => {
    f = await developmentCleanupChain(); await f.runNative();
    const selection = (await f.load(f.env.id)).native!.developmentCleanup!.selection, original = await f.participant.advance(selection);
    const page = (await f.copy.session.api.nextDevelopmentUsageSource())!;
    await f.copy.session.api.acknowledgeDevelopmentUsageSource(page.key, page.through); f.controls.priceRevision = 99; f.copy.restart();
    expect(await f.participant.advance(selection)).toEqual(original); expect(f.controls.priceCalls).toBe(1);
    const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start(); await removed; await controller.reconciled(); await controller.observer.stop();
    await f.runNative(); await f.settle(); expect((await f.load(f.env.id)).native?.state).toBe('finished');
  }, 15000);
});
