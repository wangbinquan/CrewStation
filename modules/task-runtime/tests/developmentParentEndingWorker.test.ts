// Actual API acceptance, SQL frozen membership and mounted workers. No manufactured child closure or stop proof.
import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { Worker } from '@crewstation/queue';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';
import type { DevelopmentWorkloadFixture } from './developmentWorkloadFixture';
import { endingCheckpoint } from './developmentParentEndingLeaseFixture';
import { readDevelopmentParentEnding } from '../domain/development/parentEnding';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development parent original ending mounted workers (real PG)', () => {
  let f: DevelopmentWorkloadFixture;
  afterEach(async () => { await f?.close(); });
  const prepare = async () => {
    f = await developmentWorkloadFixture();
    await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace, { status: { phase: 'Bound', capacity: { storage: '10Gi' } } });
    return f;
  };
  const runEnding = () => (f.runtime.workers[4] as Worker).runOnce();
  const recovery = () => (f.runtime.workers[5] as Worker).runOnce();
  const ending = async () => {
    const parent = await f.load(f.parent.id);
    return (await f.uow.read.parentEnding!.endings.get(readDevelopmentParentEnding(parent)!.endingId))!;
  };
  const retry = async () => {
    await f.tdb.db.execute(sql`UPDATE task_runtime.development_parent_endings SET retry_at=clock_timestamp()-interval '1 second'`);
    await recovery();
    return runEnding();
  };
  test('release seals admission and leaves the original connected workspace and every physical identity intact while children wait', async () => {
    await prepare(); const input = f.request(); await f.runtime.api.createNativeExecution(input);
    const before = await f.load(f.parent.id), used = await f.resources.api.occupancy(before.projectId), released = await f.runtime.api.releaseEnvironment(before.id, 'user');
    expect(released.state).toBe('running');
    expect(await f.load(before.id)).toMatchObject({ state: before.state, connected: true, runnerTokenHash: before.runnerTokenHash,
      podName: before.podName, pvcName: before.pvcName, parentEnding: { phase: 'admission-sealed' } });
    expect((await ending()).memberCount).toBe(1); expect((await ending()).epoch.originalRenderStart).toBeNull();
    await expect(f.runtime.api.createNativeExecution(f.request())).rejects.toThrow('封存');
    await expect(f.runtime.api.runnerValues(input.id)).rejects.toThrow('封存');
    await expect(f.runtime.api.bindWorkload(input.id, crypto.randomUUID(), crypto.randomUUID())).rejects.toThrow('封存');
    expect(await runEnding()).toBe(1);
    expect((await ending()).phase).toBe('children'); expect((await f.load(input.id)).native?.state).toBe('cleaning');
    expect(await f.uow.read.parentEnding!.children.remaining((await ending()).id)).toBe(1);
    expect((await f.safety.get((await ending()).id))?.startPermit).toBeUndefined();
    expect((await f.k8s.get(Resources.Pod!, before.podName, before.namespace))?.metadata.uid).toBe(f.parentPod.metadata.uid);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, before.pvcName, before.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
    expect(await f.resources.api.occupancy(before.projectId)).toBe(used);
    expect(await f.runtime.api.onRunnerConnected(before.id, f.parentToken)).toBe(true);
    expect(await f.load(before.id)).toMatchObject({ state: 'running', runnerTokenHash: before.runnerTokenHash, connected: true });
    await f.runtime.api.releaseEnvironment(before.id, 'user'); expect((await ending()).memberCount).toBe(1);
  }, 15000);
  test('a delayed real configuration writer is fenced after seal, and recovery reaches members beyond the first 25 without closing them', async () => {
    await prepare(); f.state.quota = 64; const inputs = Array.from({ length: 27 }, () => f.request());
    for (const input of inputs) await f.runtime.api.createNativeExecution(input);
    const blocked = endingCheckpoint(), release = endingCheckpoint(), child = await f.load(inputs[26]!.id);
    f.replace({ sources: { ...f.deps.sources, configEnv: async () => { blocked.resolve(); await release.promise; return { GREETING: 'delayed' }; } } });
    const write = f.runtime.api.runnerValues(child.id).then(() => null, (error: unknown) => error);
    try {
      await blocked.promise; await f.runtime.api.releaseEnvironment(f.parent.id, 'user'); release.resolve();
      expect(await write).toMatchObject({ message: '原开发父任务已封存新执行准入' });
      expect((await f.load(child.id)).runnerTokenHash).toBe(child.runnerTokenHash);
      expect((await ending()).memberCount).toBe(27); expect(await runEnding()).toBe(1);
      const ids = inputs.map((input) => input.id).sort(), first = await ending();
      expect(first.afterChildId).toBe(ids[24]!); expect(first.progress['waitingMember']).toBeUndefined();
      for (const id of ids.slice(0, 25)) expect((await f.load(id)).native?.state).toBe('cleaning');
      for (const id of ids.slice(25)) expect((await f.load(id)).native?.state).toBe('queued');
      expect(await retry()).toBe(1); expect((await ending()).afterChildId).toBe(ids[26]!);
      for (const id of ids.slice(25)) expect((await f.load(id)).native?.state).toBe('cleaning');
      expect(await f.uow.read.parentEnding!.children.remaining(first.id)).toBe(27);
      expect((await f.safety.get(first.id))?.stopProof).toBeUndefined();
      expect(await f.resources.api.occupancy(f.parent.projectId)).toBe(28);
      expect((await f.k8s.get(Resources.Pod!, f.parent.podName, f.parent.namespace))?.metadata.uid).toBe(f.parentPod.metadata.uid);
      // A fresh module resumes the persisted cursor; an unavailable child remains waiting rather than becoming finished.
      f.replace(); expect(await retry()).toBe(1); expect((await ending()).afterChildId).toBeNull();
      expect((await ending()).phase).toBe('children'); expect((await f.load(child.id)).native?.state).toBe('cleaning');
    } finally { release.resolve(); await write; }
  }, 30000);
  test('explicit malformed ending presence never takes the legacy release or admission paths', async () => {
    await prepare(); const before = await f.load(f.parent.id), used = await f.resources.api.occupancy(before.projectId);
    await f.tdb.db.execute(sql`UPDATE task_runtime.environments SET parent_ending='false'::jsonb WHERE id=${before.id}`);
    await expect(f.runtime.api.releaseEnvironment(before.id, 'user')).rejects.toThrow();
    await expect(f.runtime.api.createNativeExecution(f.request())).rejects.toThrow('封存');
    expect((await f.k8s.get(Resources.Pod!, before.podName, before.namespace))?.metadata.uid).toBe(f.parentPod.metadata.uid);
    expect((await f.k8s.get(Resources.PersistentVolumeClaim!, before.pvcName, before.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
    expect((await f.load(before.id)).runnerTokenHash).toBe(before.runnerTokenHash);
    expect(await f.resources.api.occupancy(before.projectId)).toBe(used);
  });
});
