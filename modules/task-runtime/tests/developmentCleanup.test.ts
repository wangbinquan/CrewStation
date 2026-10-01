// RFC-034 job fence / original object regressions; actual owner+SQLite+Session PG composition is root E2E.
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { Resources } from '@crewstation/k8s';
import { sql } from 'drizzle-orm';
import { claimJobs } from '@crewstation/queue';
import { developmentCleanupSelection } from '../domain/development/cleanupSelection';
import { requireDevelopmentCleanupEvidence } from '../domain/development/cleanupEvidence';
import { developmentPhysicalStop } from '../application/development/workloadStop';
import { NATIVE_EXECUTION_JOB_KIND } from '../ports/repositories';
import { developmentCleanupFixture } from './developmentCleanupFixture';
import type { DevelopmentCleanupFixture } from './developmentCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 bound development native cleanup', () => {
  let f: DevelopmentCleanupFixture;
  afterEach(async () => { await f?.close(); });
  const startStop = async () => { const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start(); await f.runNative(); await removed; await controller.reconciled(); await controller.observer.stop(); };
  test('new choice retains Pod, both Secrets, Runner token and quota when original receipt reading is unavailable, then resumes from the same UID', async () => {
    f = await developmentCleanupFixture('native', true, true); const before = await f.load(f.env.id), get = f.safety.get;
    const originalUid = (await get(f.env.render!.workloadConsumerId!))!.developmentAdmission!.secretUid;
    f.safety.get = async (id) => { const state = await get(id); return state ? { ...state, developmentAdmission: undefined } : undefined; };
    await f.runNative(); expect(f.physical.state.deleteRequests).toEqual([]); expect(f.control.calls).toBe(0);
    expect(await f.load(f.env.id)).toMatchObject({ runnerTokenHash: before.runnerTokenHash, connected: true, native: { state: 'cleaning' } });
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    for (const name of [f.env.podName + '-runner', f.env.podName + '-admission']) expect(await f.k8s.get(Resources.Secret!, name, f.env.namespace)).toBeDefined();
    f.safety.get = get; await startStop(); await f.runNative(); expect((await f.load(f.env.id)).native?.state).toBe('finished');
    expect((await get(f.env.render!.workloadConsumerId!))?.developmentAdmission?.secretUid).toBe(originalUid);
    await f.settle();
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
  }, 15_000);
  test('new choice keeps a same-name same-content admission clone instead of borrowing its current UID after all original containers stop', async () => {
    f = await developmentCleanupFixture('ledger', true, true); await startStop();
    const original = (await f.k8s.get(Resources.Secret!, f.env.podName + '-admission', f.env.namespace))!, replacement = crypto.randomUUID();
    await f.k8s.mergePatch(Resources.Secret!, original.metadata.name, f.env.namespace, { metadata: { uid: replacement } });
    await f.runNative(); expect(f.physical.state.deleteRequests).not.toContain('Secret:' + original.metadata.name);
    expect((await f.k8s.get(Resources.Secret!, original.metadata.name, f.env.namespace))?.metadata.uid).toBe(replacement);
    expect((await f.load(f.env.id)).native?.state).toBe('cleaning'); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  }, 15_000);
  for (const mode of ['ledger', 'native'] as const) {
    test(mode + ': actual Controller proof precedes Secret reclaim and final single quota release', async () => {
      f = await developmentCleanupFixture(mode); const before = await f.load(f.env.id);
      await startStop();
      const waiting = await f.load(f.env.id); expect(waiting.native?.state).toBe('cleaning');
      expect(waiting.native?.developmentCleanup?.closure.status).toBe('complete'); expect(waiting.connected).toBe(true); expect(waiting.runnerTokenHash).toBe(before.runnerTokenHash);
      expect((await f.resources.api.get(f.env.id))?.desired).toBe('present'); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
      expect(f.physical.state.deleteRequests.filter((s) => s.startsWith('Secret:'))).toEqual([]);
      expect((await f.safety.get(f.env.render!.workloadConsumerId!))?.stopProof?.podUid).toBe(f.env.native!.podUid);
      await f.runNative(); const finished = await f.load(f.env.id);
      expect(finished.native?.state).toBe('finished'); expect(finished.connected).toBe(false); expect(finished.runnerTokenHash).not.toBe(before.runnerTokenHash);
      await f.settle();
      expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1); expect((await f.resources.api.get(f.env.id))?.desired).toBe('absent');
      expect(f.physical.state.deleteRequests.filter((s) => s.startsWith('Secret:'))).toHaveLength(2);
      await f.runtime.api.releaseEnvironment(f.env.id, 'user'); await f.runNative(); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
      expect((await f.k8s.get(Resources.Pod!, f.parent.podName, f.parent.namespace))?.metadata.uid).toBe(f.parentPod.metadata.uid);
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
    }, 15_000);
  }
  test('missing participant and pending digital copy cannot issue a Pod deletion or invalidate drain credentials', async () => {
    f = await developmentCleanupFixture(); const before = await f.load(f.env.id);
    f.control.permitted = false; await f.runNative(); expect(f.physical.state.deleteRequests).toEqual([]);
    f.replace({ developmentCleanup: undefined }); await f.runNative(); expect(f.physical.state.deleteRequests).toEqual([]);
    expect(await f.load(f.env.id)).toMatchObject({ runnerTokenHash: before.runnerTokenHash, connected: true, native: { state: 'cleaning' } });
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('Pod delete lost ACK and an already removed finalizer still wait for the original UID to vanish', async () => {
    f = await developmentCleanupFixture('native'); f.physical.state.losePodAck = true; f.physical.state.holdPod = true;
    await startStop(); await f.runNative();
    expect((await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace))?.metadata.finalizers).toEqual([]);
    expect(f.physical.state.deleteRequests.filter((s) => s.startsWith('Secret:'))).toEqual([]);
    expect((await f.load(f.env.id)).native?.state).toBe('cleaning');
    await f.physical.finishDeletion(); await f.runNative(); expect((await f.load(f.env.id)).native?.state).toBe('finished');
  }, 15_000);
  for (const field of ['loseRunnerAck', 'loseAdmissionAck'] as const) {
    test(field + ': immutable numeric permit and original stop proof recover after Secret delete ACK loss', async () => {
      f = await developmentCleanupFixture(); await startStop(); f.physical.state[field] = true;
      const permit = (await f.load(f.env.id)).native!.developmentCleanup;
      await f.runNative(); expect((await f.load(f.env.id)).native?.state).toBe('cleaning'); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
      await f.runNative(); expect((await f.load(f.env.id)).native?.state).toBe('finished'); expect((await f.load(f.env.id)).native?.developmentCleanup).toEqual(permit);
      await f.settle();
      expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
    }, 15_000);
  }
  test('a main container still running keeps the original stop finalizer, both Secrets and quota', async () => {
    f = await developmentCleanupFixture(); f.physical.state.autoStop = false;
    const requested = f.wait('pod-delete'), controller = f.controller(); controller.observer.start(); await f.runNative(); await requested; const inspected = f.receipt('read:' + f.env.podName); await inspected; await controller.observer.stop();
    expect((await f.safety.get(f.env.render!.workloadConsumerId!))?.stopProof).toBeNull(); expect(f.physical.state.deleteRequests.filter((s) => s.startsWith('Secret:'))).toEqual([]);
    expect((await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace))?.metadata.finalizers).not.toEqual([]); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('replacement Pod UID and changed immutable selection never authorize same-name deletion', async () => {
    f = await developmentCleanupFixture();
    await f.k8s.mergePatch(Resources.Pod!, f.env.podName, f.env.namespace, { metadata: { uid: crypto.randomUUID() } }); await f.runNative();
    expect(f.physical.state.deleteRequests).toEqual([]); expect((await f.load(f.env.id)).native?.state).toBe('cleaning');
    const selected = developmentCleanupSelection(await f.load(f.env.id))!;
    expect(() => requireDevelopmentCleanupEvidence({ ...f.control.evidence, selection: { ...selected, profileRevision: 4 } }, selected)).toThrow();
  });
  test('wrong Runner token or original admission tuple cannot be reclaimed', async () => {
    f = await developmentCleanupFixture(); await startStop();
    await f.k8s.mergePatch(Resources.Secret!, f.env.podName + '-runner', f.env.namespace, { stringData: { CS_RUNNER_TOKEN: 'replacement' } }); await f.runNative();
    expect(f.physical.state.deleteRequests.filter((s) => s.startsWith('Secret:'))).toEqual([]);
    expect((await f.load(f.env.id)).native?.state).toBe('cleaning');
  });
  test('a changed original Runner Secret UID is retained even when its labels and token match', async () => {
    f = await developmentCleanupFixture(); await startStop();
    await f.k8s.mergePatch(Resources.Secret!, f.env.podName + '-runner', f.env.namespace, { metadata: { uid: crypto.randomUUID() } }); await f.runNative();
    expect(f.physical.state.deleteRequests.filter((s) => s.startsWith('Secret:'))).toEqual([]);
    expect((await f.load(f.env.id)).native?.state).toBe('cleaning'); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('a wrong admission tuple holds cleanup after the matching Runner Secret was reclaimed', async () => {
    f = await developmentCleanupFixture(); await startStop();
    await f.k8s.mergePatch(Resources.Secret!, f.env.podName + '-admission', f.env.namespace, { stringData: { volumeUid: crypto.randomUUID() } }); await f.runNative();
    expect(await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace)).toBeUndefined();
    expect(await f.k8s.get(Resources.Secret!, f.env.podName + '-admission', f.env.namespace)).not.toBeUndefined();
    expect((await f.load(f.env.id)).native?.state).toBe('cleaning'); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('same-name Secret replacement between read and delete cannot evade API UID preconditions', async () => {
    f = await developmentCleanupFixture(); await startStop(); const replacement = crypto.randomUUID();
    f.physical.state.beforeSecretDelete = async () => {
      f.physical.state.beforeSecretDelete = undefined;
      await f.k8s.mergePatch(Resources.Secret!, f.env.podName + '-runner', f.env.namespace, { metadata: { uid: replacement } });
    };
    await f.runNative();
    expect((await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace))?.metadata.uid).toBe(replacement);
    expect((await f.load(f.env.id)).native?.state).toBe('cleaning'); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('wrong Node, consumer and incomplete container proofs cannot reclaim Secrets despite Pod absence', async () => {
    f = await developmentCleanupFixture(); await startStop(); const original = (await f.safety.get(f.env.render!.workloadConsumerId!))!;
    const bad = [ { ...original, stopProof: { ...original.stopProof!, nodeUid: crypto.randomUUID() } },
      { ...original, stopProof: { ...original.stopProof!, consumer: { ...original.stopProof!.consumer, generation: 9 } } },
      { ...original, stopProof: { ...original.stopProof!, containers: original.stopProof!.containers.filter((container) => container.kind === 'init') } } ];
    for (const record of bad) {
      f.replace({ developmentCleanup: f.participant, workloadSafety: { ...f.safety, get: async () => record } }); await f.runNative();
      expect(f.physical.state.deleteRequests.filter((s) => s.startsWith('Secret:'))).toEqual([]); expect((await f.load(f.env.id)).native?.state).toBe('cleaning');
    }
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('job takeover during Secret I/O cannot authorize the stale worker final quota transaction', async () => {
    f = await developmentCleanupFixture('ledger', true, true); await startStop(); const permit = (await f.load(f.env.id)).native!.developmentCleanup;
    f.physical.state.beforeSecretDelete = async () => {
      f.physical.state.beforeSecretDelete = undefined;
      await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = ${NATIVE_EXECUTION_JOB_KIND} AND state = 'running'`);
      const [next] = await claimJobs(f.tdb.db, [NATIVE_EXECUTION_JOB_KIND], 'cleanup-final-takeover', 120, 1); expect(next?.fencingToken).toBeGreaterThan(2);
    };
    await f.runNative(); expect((await f.load(f.env.id)).native?.state).toBe('cleaning'); expect((await f.load(f.env.id)).native?.developmentRemovalSeal).toBeUndefined();
    expect((await f.load(f.env.id)).native?.developmentCleanup).toEqual(permit); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('actual job takeover before digital commit rejects an old worker despite its optimistic heartbeat', async () => {
    f = await developmentCleanupFixture('ledger', true, true);
    f.control.onAdvance = async () => {
      await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE kind = ${NATIVE_EXECUTION_JOB_KIND} AND state = 'running'`);
      const [next] = await claimJobs(f.tdb.db, [NATIVE_EXECUTION_JOB_KIND], 'cleanup-takeover', 120, 1); expect(next?.fencingToken).toBe(2);
    };
    await f.runNative(); expect((await f.load(f.env.id)).native?.developmentCleanup).toBeUndefined(); expect((await f.load(f.env.id)).native?.developmentRemovalSeal).toBeUndefined(); expect(f.physical.state.deleteRequests).toEqual([]); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  });
  test('missing, malformed or wrong consumer/node physical proofs never mean stopped for development', async () => {
    f = await developmentCleanupFixture();
    await expect(developmentPhysicalStop(undefined, await f.load(f.env.id))).rejects.toThrow();
    await expect(developmentPhysicalStop(f.safety, await f.load(f.env.id))).rejects.toThrow();
    const selection = developmentCleanupSelection(await f.load(f.env.id))!;
    expect(developmentCleanupSelection({ ...await f.load(f.env.id), connected: false, lastActivityAt: new Date(), updatedAt: new Date() })).toEqual(selection);
    expect(developmentCleanupSelection({ ...await f.load(f.env.id), render: { ...f.env.render!, developmentUsageProtection: undefined } })).toBeUndefined();
  });
});
