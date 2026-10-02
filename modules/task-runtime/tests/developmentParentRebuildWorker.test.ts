// Real original PG, mounted ending/rebuild workers and independent Controller; Kubernetes scheduling is controlled.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { developmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import type { DevelopmentParentPhysicalFixture } from './developmentParentPhysicalFixture';
import { readDevelopmentParentEnding } from '../domain/development/parentEnding';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('selected parent real rebuild delivery (real PG)', () => {
  let f: DevelopmentParentPhysicalFixture;
  afterEach(async () => { await f?.close(); });
  const request = async () => {
    const check = await f.runtime.api.inspectRebuild(f.projectId, true), profile = check.profiles[0]!;
    return { requestId: crypto.randomUUID(), expectedTaskId: f.parent.id, expectedUpdatedAt: check.updatedAt,
      expectedPodUid: check.podUid, expectedVolumeUid: check.volume.uid, reason: 'administrator-restart' as const,
      profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
  };
  const deliverRebuild = async () => {
    await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET run_at=clock_timestamp()-interval '1 second'`);
    return (f.runtime.workers[0] as Worker).runOnce();
  };
  const stopOriginal = async () => {
    const controller = f.controller(); controller.observer.start();
    try { await f.runEnding(); await f.parentPhysical.waitRemoved(); } finally { await controller.observer.stop(); }
    await controller.reconciled(); await f.retry();
  };
  for (const mode of ['native', 'ledger'] as const) test(mode + ': acceptance seals original epoch; actual rebuild publishes only after independent exit and reuses PVC', async () => {
    f = await developmentParentPhysicalFixture(mode); const before = await f.load(f.parent.id), input = await request();
    const accepted = await f.runtime.api.requestRebuild(f.projectId, input), sealed = await f.load(before.id);
    expect(sealed.state).toBe('running'); expect(sealed.connected).toBe(true); expect(sealed.podName).toBe(before.podName);
    expect(sealed.runnerTokenHash).toBe(before.runnerTokenHash); expect(sealed.rebuildId).toBe(before.rebuildId);
    expect((await f.runtime.api.getRebuild(before.id))?.id).toBe(accepted.id);
    expect((await f.runtime.api.getRebuild(before.id))?.state).toBe('queued');
    expect(await f.k8s.get(Resources.Pod!, before.podName, before.namespace)).toBeDefined();
    await deliverRebuild(); expect((await f.load(before.id)).runnerTokenHash).toBe(before.runnerTokenHash);
    expect((await f.uow.read.rebuilds.get(accepted.id))?.attempts ?? 0).toBe(0);
    await stopOriginal(); const published = await f.load(before.id), source = await f.uow.read.parentEnding!.endings.get(readDevelopmentParentEnding(sealed)!.endingId);
    expect(source?.phase).toBe('complete'); expect(source?.completionWitness?.['outcome']).toBe('rebuild-published');
    expect(published.state).toBe('creating'); expect(published.podName).not.toBe(before.podName); expect(published.rebuildId).toBe(accepted.id);
    expect(published.runnerTokenHash).not.toBe(before.runnerTokenHash); expect(published.parentEnding).toBeUndefined();
    expect(published.render?.start ?? null).toBe(mode === 'ledger' ? 1 : null);
    await deliverRebuild();
    if (mode === 'ledger') {
      const reconciled = f.receipt('rebuild-reconciled'), controller = f.controller(); controller.observer.start();
      try { await reconciled; } finally { await controller.observer.stop(); }
    }
    const prepared = await f.load(before.id), record = (await f.uow.read.rebuilds.get(accepted.id))!;
    expect(record.state).toBe('starting'); expect(record.podUid).toBe(prepared.podUid); expect(record.secretUid).toBeTruthy();
    expect((await f.k8s.get(Resources.Pod!, prepared.podName, prepared.namespace))?.metadata.uid).toBe(prepared.podUid);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, before.pvcName, before.namespace))?.metadata.uid).toBe(input.expectedVolumeUid);
    const secret = (await f.k8s.get(Resources.Secret!, prepared.podName + '-runner', prepared.namespace))!;
    expect(await f.runtime.api.onRunnerConnected(prepared.id, (secret['stringData'] as Record<string, string>)['CS_RUNNER_TOKEN']!)).toBe(true);
    const ready = await f.load(before.id); expect(ready.state).toBe('running'); expect((await f.runtime.api.getRebuild(before.id))?.state).toBe('ready');
    await deliverRebuild(); expect((await f.load(before.id)).runnerTokenHash).toBe(ready.runnerTokenHash);
    expect((await f.load(before.id)).render?.start ?? null).toBe(mode === 'ledger' ? 1 : null);
    expect((await f.uow.read.parentEnding!.endings.get(source!.id))?.completionWitness).toEqual(source?.completionWitness);
  }, 25000);
});
