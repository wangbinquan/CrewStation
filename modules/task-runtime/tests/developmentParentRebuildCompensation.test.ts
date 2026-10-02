// Real original completion source plus new Pod's own independent exit; no reuse of the old Pod proof.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { readDevelopmentParentEnding } from '../domain/development/parentEnding';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('selected new rebuild compensation and completed claim (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  const request = async (admin: boolean) => {
    const check = await f.runtime.api.inspectRebuild(f.projectId, admin), profile = check.profiles[0]!;
    return { requestId: crypto.randomUUID(), expectedTaskId: f.parent.id, expectedUpdatedAt: check.updatedAt,
      expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid, ...(admin ? { reason: 'administrator-restart' as const } : {}),
      profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
  };
  const deliver = async () => { await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`); return (f.runtime.workers[0] as Worker).runOnce(); };
  const stop = async (physical: DevelopmentParentPhysicalFixture['parentPhysical']) => {
    const controller = f.controller(); controller.observer.start();
    try { await f.runEnding(); await physical.waitRemoved(); } finally { await controller.observer.stop(); }
    await f.retry();
  };
  const prepareNew = async (mode: 'native' | 'ledger') => {
    await deliver();
    if (mode === 'ledger') {
      const applied = f.receipt('rebuild-reconciled'), controller = f.controller(); controller.observer.start();
      try { await applied; } finally { await controller.observer.stop(); }
    }
  };
  for (const mode of ['native', 'ledger'] as const) test(mode + ': new failure waits for its own proof, then an actual REBUILD job publishes the completed original claim', async () => {
    f = await developmentParentPhysicalFixture(mode); const old = await f.load(f.parent.id);
    const first = await f.runtime.api.requestRebuild(f.projectId, await request(true)), firstSeal = readDevelopmentParentEnding(await f.load(old.id))!;
    await stop(f.parentPhysical); await prepareNew(mode); const prepared = await f.load(old.id), actualNew = await f.rebuiltPhysical();
    expect(prepared.state).toBe('creating'); expect((await f.uow.read.rebuilds.get(first.id))?.state).toBe('starting');
    await f.runtime.api.markFailed(prepared.id, 'controlled new startup failure'); const sealed = await f.load(old.id), newSeal = readDevelopmentParentEnding(sealed)!;
    expect(newSeal.endingId).not.toBe(firstSeal.endingId); expect(sealed.state).toBe('creating'); expect(sealed.runnerTokenHash).toBe(prepared.runnerTokenHash);
    expect((await f.safety.get(newSeal.endingId))?.stopProof).toBeUndefined();
    await stop(actualNew); const failed = await f.load(old.id), completed = (await f.uow.read.parentEnding!.endings.get(newSeal.endingId))!;
    expect(completed.phase).toBe('complete'); expect(completed.completionWitness?.['outcome']).toBe('compensation');
    expect(prepared.podUid).toBeTruthy(); expect(completed.epoch.podUid).toBe(prepared.podUid!); expect(completed.epoch.podUid).not.toBe(f.parentPod.metadata.uid);
    expect((await f.safety.get(newSeal.endingId))?.stopProof?.podUid).toBe(prepared.podUid);
    expect(failed.state).toBe('failed'); expect(failed.runnerTokenHash).not.toBe(prepared.runnerTokenHash);
    expect((await f.uow.read.rebuilds.get(first.id))?.state).toBe('failed');
    expect(await f.k8s.get(Resources.Pod!, prepared.podName, prepared.namespace)).toBeUndefined();
    expect(await f.k8s.get(Resources.Secret!, prepared.podName + '-runner', prepared.namespace)).toBeUndefined();
    const secondInput = await request(false), second = await f.runtime.api.requestRebuild(f.projectId, secondInput);
    expect((await f.runtime.api.getRebuild(old.id))?.id).toBe(second.id);
    expect((await f.load(old.id)).runnerTokenHash).toBe(failed.runnerTokenHash); expect((await f.load(old.id)).state).toBe('failed');
    const claim = (await f.uow.read.parentEnding!.claims.get(newSeal.endingId))!; expect(claim.state).toBe('pending'); expect(claim.currentRebuildId).toBe(second.id);
    await prepareNew(mode); const restored = await f.load(old.id);
    expect(restored.state).toBe('creating'); expect(restored.podName).not.toBe(prepared.podName); expect(restored.rebuildId).toBe(second.id);
    expect((await f.uow.read.rebuilds.get(second.id))?.state).toBe('starting');
    expect((await f.uow.read.parentEnding!.claims.get(newSeal.endingId))?.state).toBe('published');
    expect(restored.render?.start ?? null).toBe(mode === 'ledger' ? 2 : null);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, old.pvcName, old.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
    expect((await f.uow.read.parentEnding!.endings.get(newSeal.endingId))?.completionWitness).toEqual(completed.completionWitness);
  }, 30000);
});
