import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { Resources } from '@crewstation/k8s';
import type { Worker } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import { readDevelopmentParentEnding } from '../domain/development/parentEnding';
import { closeDevelopmentAdmission } from '../application/development/workloadStop';
import { developmentWorkloadFixture } from './developmentWorkloadFixture';
import { developmentPrestartCleanupFixture } from './developmentPrestartCleanupFixture';
import type { DevelopmentPrestartCleanupFixture } from './developmentPrestartCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 no-grant original physical boundary failures', () => {
  let f: DevelopmentPrestartCleanupFixture;
  afterEach(async () => { await f?.close(); });
  test('init still running retains original finalizer, Runner credential and occupancy', async () => {
    f = await developmentPrestartCleanupFixture(); f.physical.state.autoStop = false; await f.runNative();
    const controller = f.controller(); controller.observer.start(); await controller.reconciled(); await controller.observer.stop();
    expect((await f.safety.get(f.env.render!.workloadConsumerId!))?.stopProof).toBeNull();
    expect(await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace)).toBeDefined();
    expect(await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace)).toBeDefined();
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  }, 15_000);
  test('a replacement original Pod UID cannot get a delete request', async () => {
    f = await developmentPrestartCleanupFixture(); const replacement = crypto.randomUUID();
    await f.k8s.mergePatch(Resources.Pod!, f.env.podName, f.env.namespace, { metadata: { uid: replacement } }); await f.runNative();
    expect(f.physical.state.deleteRequests).toEqual([]); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
  }, 15_000);
  test('owner closed phase failure retains Runner credential after actual physical stop and resumes on replay', async () => {
    f = await developmentPrestartCleanupFixture(); f.control.complete = false;
    const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start();
    await f.runNative(); await removed; await controller.reconciled(); await controller.observer.stop(); await f.runNative();
    expect((await f.load(f.env.id)).native?.developmentCleanup).toMatchObject({ phase: 'stopping', numericState: 'unknown' });
    expect(await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace)).toBeDefined();
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    f.control.complete = true; await f.runNative(); await f.settle();
    expect((await f.load(f.env.id)).native?.state).toBe('finished'); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
  }, 15_000);
});

test.skipIf(!available)('actual Controller admission and Resources close compete under the original PG consumer lock', async () => {
  const base = await developmentWorkloadFixture('native');
  try {
    const input = base.request(); await base.runtime.api.createNativeExecution(input); await base.runNative();
    const original = await base.load(input.id), grantStart = base.safety.grantStart;
    let completed: (() => void) | undefined, rejected: ((error: unknown) => void) | undefined, raced = false;
    const receipt = new Promise<void>((resolve, reject) => { completed = resolve; rejected = reject; });
    base.safety.grantStart = async (id, permit) => {
      if (raced) return grantStart(id, permit);
      raced = true;
      try {
        const results = await Promise.allSettled([closeDevelopmentAdmission(base.safety, original), grantStart(id, permit)]);
        expect(results[0]!.status).toBe('fulfilled');
        const state = (await base.safety.get(id))!; expect(state.admissionClosed).toBe(true);
        if (results[1]!.status === 'fulfilled') expect(state.startPermit?.podUid).toBe(permit.podUid);
        else expect(state.startPermit).toBeNull();
        completed!();
        if (results[1]!.status === 'rejected') throw results[1].reason;
        return results[1].value;
      } catch (error) { rejected!(error); throw error; }
    };
    const controller = base.controller(); controller.observer.start(); await receipt; await controller.observer.stop();
    expect(raced).toBe(true); expect(await base.resources.api.occupancy(original.projectId)).toBe(2);
  } finally { await base.close(); }
}, 15_000);


test.skipIf(!available)('the generic removal lookup retains no-grant credentials until closed and rejects an invented admission Secret', async () => {
  const f = await developmentPrestartCleanupFixture();
  try {
    f.control.complete = false;
    const runner = (await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace))!;
    const selected = { kind: 'Secret' as const, namespace: f.env.namespace, name: runner.metadata.name, uid: runner.metadata.uid!, operation: 'delete' as const };
    const removed = f.wait('finalizer-removed'), controller = f.controller(); controller.observer.start();
    await f.runNative(); await removed; await controller.reconciled(); await controller.observer.stop();
    expect((await f.safety.get(f.env.render!.workloadConsumerId!))?.startPermit).toBeNull();
    expect((await f.load(f.env.id)).native?.developmentCleanup).toMatchObject({ version: 2, phase: 'stopping' });
    expect(await f.runtime.api.inspectDevelopmentRemoval(selected)).toMatchObject({ kind: 'waiting' });
    f.control.complete = true; await f.runNative(); await f.settle();
    const finished = await f.load(f.env.id);
    expect(finished.native?.developmentCleanup).toMatchObject({ phase: 'closed', numericState: 'unknown' });
    expect(finished.runnerTokenHash).not.toBe(f.env.runnerTokenHash);
    // Replay the actual original Secret materials to model a delayed original creator, not a new UID grant.
    await f.k8s.create(runner);
    expect(await f.runtime.api.inspectDevelopmentRemoval(selected)).toMatchObject({ kind: 'permitted' });
    expect(await f.runtime.api.inspectDevelopmentRemoval({ ...selected, uid: crypto.randomUUID() })).toMatchObject({ kind: 'waiting' });
    expect(await f.runtime.api.inspectDevelopmentRemoval({ ...selected, name: f.env.podName + '-admission' })).toMatchObject({ kind: 'waiting' });
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
  } finally { await f.close(); }
}, 15_000);

test.skipIf(!available)('the real frozen parent membership records closed no-grant children as unknown without reopening numeric cleanup', async () => {
  const f = await developmentPrestartCleanupFixture();
  try {
    const originalParentPodUid = f.parentPod.metadata.uid;
    expect(originalParentPodUid).toBeDefined();
    if (!originalParentPodUid) throw new Error('fixture original parent Pod UID missing');
    // Freeze the real still-active member first; already released children are deliberately outside new membership.
    await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace, { status: { phase: 'Bound', capacity: { storage: '10Gi' } } });
    await f.runtime.api.releaseEnvironment(f.parent.id, 'user');
    const parent = await f.load(f.parent.id), pointer = readDevelopmentParentEnding(parent)!;
    const ending = (await f.uow.read.parentEnding!.endings.get(pointer.endingId))!;
    expect(ending.memberCount).toBe(1);
    expect(await (f.runtime.workers[4] as Worker).runOnce()).toBe(1);
    expect(await f.uow.read.parentEnding!.children.remaining(ending.id)).toBe(1);
    await f.finalize(); const child = await f.load(f.env.id);
    expect(child.native?.developmentCleanup).toMatchObject({ version: 2, phase: 'closed', numericState: 'unknown' });
    await f.tdb.db.execute(sql`UPDATE task_runtime.development_parent_endings SET retry_at=clock_timestamp()-interval '1 second' WHERE id=${ending.id}`);
    await (f.runtime.workers[5] as Worker).runOnce();
    expect(await (f.runtime.workers[4] as Worker).runOnce()).toBe(1);
    // The bounded durable sweep reaches EOF before revisiting the now-closed original member.
    expect((await f.uow.read.parentEnding!.endings.get(ending.id))?.afterChildId).toBeNull();
    await f.tdb.db.execute(sql`UPDATE task_runtime.development_parent_endings SET retry_at=clock_timestamp()-interval '1 second' WHERE id=${ending.id}`);
    await (f.runtime.workers[5] as Worker).runOnce();
    expect(await (f.runtime.workers[4] as Worker).runOnce()).toBe(1);
    const members = await f.tdb.db.execute<{ childId: string; closed: boolean; closure: unknown }>(sql`SELECT child_id AS "childId", closed, closure FROM task_runtime.development_parent_ending_children WHERE ending_id=${ending.id}`);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ childId: child.id, closed: true, closure: { kind: 'protected-prestart-closed',
      numericEvidence: child.native!.developmentCleanup, numericStatus: 'unknown', tailUnknown: true,
      stopProofDigest: child.native!.developmentCleanup!.version === 2 ? child.native!.developmentCleanup!.stopProofDigest : null } });
    expect(await f.uow.read.parentEnding!.children.remaining(ending.id)).toBe(0);
    expect(await f.uow.read.parentEnding!.children.liveUnfinished(ending.id)).toBe(0);
    const progressed = (await f.uow.read.parentEnding!.endings.get(ending.id))!;
    expect(progressed.phase).not.toBe('children');
    expect(progressed.epoch.podUid).toBe(originalParentPodUid);
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
    expect((await f.safety.get(child.render!.workloadConsumerId!))?.startPermit).toBeNull();
  } finally { await f.close(); }
}, 15_000);
