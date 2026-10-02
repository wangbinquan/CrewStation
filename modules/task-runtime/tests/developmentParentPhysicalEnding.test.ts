// Actual Controller, queue leases and PG completion source; only the Kubernetes API and child digital participant are controlled.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { jsonHash } from '@crewstation/kernel';
import { endingCheckpoint } from './developmentParentEndingLeaseFixture';
import { sql } from 'drizzle-orm';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original parent independent physical completion (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  const stop = async () => {
    const controller = f.controller(); controller.observer.start();
    await f.runEnding(); await f.parentPhysical.waitRemoved(); await controller.reconciled(); await controller.observer.stop();
  };
  test('real original Start ACK and all-container Stop ACK precede release, credential rotation and single quota release', async () => {
    f = await developmentParentPhysicalFixture(); const before = await f.load(f.parent.id);
    await f.runtime.api.releaseEnvironment(before.id, 'user'); await stop();
    const pending = await f.ending(), state = await f.safety.get(pending.id);
    expect(state?.consumer.purpose).toBe('development'); expect(state?.startPermit?.podUid).toBe(f.parentPod.metadata.uid);
    expect(state?.stopProof?.podUid).toBe(f.parentPod.metadata.uid); expect(state?.stopProof?.type).toBe('kubelet-terminated');
    expect(state?.stopProof?.containers).toHaveLength((pending.progress['materials'] as { containers: unknown[] }).containers.length);
    expect(await f.safety.admissionClosed(pending.id)).toBe(true);
    expect(await f.k8s.get(Resources.Pod!, before.podName, before.namespace)).toBeUndefined();
    await f.retry(); const after = await f.load(before.id), done = await f.ending();
    expect(done.phase).toBe('complete'); expect(done.status).toBe('complete'); expect(done.completionWitness?.['outcome']).toBe('released');
    expect(after.state).toBe('released'); expect(after.connected).toBe(false); expect(after.runnerTokenHash).not.toBe(before.runnerTokenHash);
    expect(done.epoch.runnerTokenHash).toBe(before.runnerTokenHash); expect(done.epoch.originalRenderStart).toBeNull();
    expect(done.memberCount).toBe(1); expect(await f.uow.read.parentEnding!.children.liveUnfinished(done.id)).toBe(0);
    await f.settleParent(); expect(await f.resources.api.occupancy(before.projectId)).toBe(0);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, before.pvcName, before.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
    const witness = jsonHash(done.completionWitness); await f.runtime.api.releaseEnvironment(before.id, 'user'); await f.retry();
    expect((await f.load(before.id)).runnerTokenHash).toBe(after.runnerTokenHash); expect(jsonHash((await f.ending()).completionWitness)).toBe(witness);
    await f.settleParent(); expect(await f.resources.api.occupancy(before.projectId)).toBe(0);
  }, 20000);
  test('lost delete ACK and a Pod retained after finalizer removal cannot substitute for actual original UID absence', async () => {
    f = await developmentParentPhysicalFixture('native'); const before = await f.load(f.parent.id);
    f.parentPhysical.state.loseDeleteAck = true; f.parentPhysical.state.holdPod = true;
    await f.runtime.api.releaseEnvironment(before.id, 'user'); await stop(); await f.retry();
    expect((await f.ending()).phase).toBe('proved'); expect((await f.load(before.id)).runnerTokenHash).toBe(before.runnerTokenHash);
    expect(await f.resources.api.occupancy(before.projectId)).toBe(1);
    expect((await f.k8s.get(Resources.Pod!, before.podName, before.namespace))?.metadata.uid).toBe(f.parentPod.metadata.uid);
    await f.parentPhysical.finishDeletion(); f.replace({ developmentCleanup: f.participant }); await f.retry();
    expect((await f.ending()).phase).toBe('complete'); expect((await f.load(before.id)).state).toBe('released');
    await f.settleParent(); expect(await f.resources.api.occupancy(before.projectId)).toBe(0);
  }, 20000);
  test('a changed closed child numeric receipt blocks full parent closure and never reuses the old digest', async () => {
    f = await developmentParentPhysicalFixture(); const before = await f.load(f.parent.id);
    await f.runtime.api.releaseEnvironment(before.id, 'user'); await stop();
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET native=jsonb_set(native,'{developmentCleanup,closure,tailUnknown}','true'::jsonb) WHERE id=${f.env.id}`);
    await f.retry(); expect((await f.ending()).phase).not.toBe('complete');
    expect((await f.load(before.id)).runnerTokenHash).toBe(before.runnerTokenHash); expect(await f.resources.api.occupancy(before.projectId)).toBe(1);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, before.pvcName, before.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
  }, 20000);

  test('a naturally terminated original Pod with persisted Stop proof still receives DELETE before completion', async () => {
    f = await developmentParentPhysicalFixture('native'); const before = await f.load(f.parent.id);
    await f.runtime.api.releaseEnvironment(before.id, 'user');
    const originalDelete = f.k8s.delete;
    f.k8s.delete = async (...args) => { if (args[0].kind === 'Pod' && args[1] === before.podName) throw new Error('controlled failure before DELETE submission'); return originalDelete(...args); };
    try { await f.runEnding(); } finally { f.k8s.delete = originalDelete; }
    const pending = await f.ending(); expect(pending.phase).toBe('stop-intent'); expect(f.parentPhysical.state.deletes).toBe(0);
    await f.parentPhysical.terminate(); const proof = endingCheckpoint(), recordStop = f.safety.recordStop;
    f.safety.recordStop = async (input) => { const result = await recordStop(input); if (input.consumer.id === pending.id) proof.resolve(); return result; };
    const controller = f.controller(); let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      controller.observer.start(); await Promise.race([proof.promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('natural original Controller proof missing')), 8000); })]);
      expect((await f.safety.get(pending.id))?.stopProof?.podUid).toBe(f.parentPod.metadata.uid);
      expect((await f.k8s.get(Resources.Pod!, before.podName, before.namespace))?.metadata.deletionTimestamp).toBeUndefined();
      expect(f.parentPhysical.state.deletes).toBe(0); expect((await f.ending()).phase).toBe('stop-intent');
      await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`);
      await f.retry(); await f.parentPhysical.waitRemoved();
    } finally { if (timer) clearTimeout(timer); await controller.observer.stop(); f.safety.recordStop = recordStop; }
    await f.retry(); const done = await f.ending(); expect(done.phase).toBe('complete'); expect(done.completionWitness?.['outcome']).toBe('released');
    expect(f.parentPhysical.state.deletes).toBe(1); expect(await f.k8s.get(Resources.Pod!, before.podName, before.namespace)).toBeUndefined();
    expect(await f.k8s.get(Resources.Secret!, before.podName + '-runner', before.namespace)).toBeUndefined();
    await f.settleParent(); expect(await f.resources.api.occupancy(before.projectId)).toBe(0);
    await f.retry(); expect(f.parentPhysical.state.deletes).toBe(1); expect((await f.load(before.id)).runnerTokenHash).not.toBe(before.runnerTokenHash);
  }, 25000);
});
