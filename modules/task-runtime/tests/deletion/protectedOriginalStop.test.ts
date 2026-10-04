import { describe, expect, test } from 'bun:test';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { RuntimeWorkSources } from '../../ports/deletion/work';
import { developmentCleanupFixture } from '../developmentCleanupFixture';

const available = await testDatabaseAvailable();
/** Actual original acceptance, job, SQL and controller. Pod statuses and digital receipts are controlled, not model acceptance. */
async function protectedFixture() {
  const f = await developmentCleanupFixture('native', false, true), operationId = newResourceId();
  let phase: 'seal' | 'stop' = 'seal', deleting = false;
  const processIdentity = { podUid: newResourceId(), containerId: 'containerd://' + 'e'.repeat(64), nodeUid: newResourceId(), nodeName: 'controlled-runtime-owner',
    pid: process.pid, pidNamespace: '711', bootId: newResourceId(), startTicks: '124' };
  const sources: RuntimeWorkSources = { resolve: async (kind, key) => {
    if (kind === 'business-task') return undefined;
    if (key !== (kind === 'project' ? f.projectId : f.serviceId)) return undefined;
    return { complete: true, id: key, scope: 'project', projectIds: [f.projectId], revision: jsonHash({ kind, key, project: f.projectId }) };
  }, assertAvailable: async () => { if (deleting) throw precondition('controlled project deleting', { code: 'project_deletion_admission_closed' }); },
  assertGrant: async (context) => { if (context.operationId !== operationId || context.target.id !== f.projectId || context.generation !== 1 || context.phase !== phase)
    throw precondition('controlled current original Root grant required'); }, processes: {
    protectCurrent: async () => processIdentity, sweep: async () => undefined,
  } };
  const runtime = f.replace({ deletionWorkSources: sources, deletionStops: { development: () => f.participant,
    digital: async () => ({ kind: 'waiting', reason: 'controlled parent waits; this test only resumes its original independent child' }),
    stopped: async (_context, env) => {
      const state = await f.safety.get(env.render!.workloadConsumerId!);
      if (!state?.admissionClosed || state.stopProof?.podUid !== env.native!.podUid || state.startPermit?.podUid !== env.native!.podUid) return undefined;
      return { digest: jsonHash(state.stopProof) };
    },
  } });
  f.calls.length = 0;
  const owner = runtime.api.deletionOwner!;
  const target = { id: f.projectId, serviceId: f.serviceId, slug: 'original-protected', name: 'Original protected', namespace: f.env.namespace,
    kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' };
  const confirmed = await owner.inspect(ProjectDeletionContextSchema.shape.target.parse(target));
  const context = () => ProjectDeletionContextSchema.parse({ operationId, generation: 1, phase, target, confirmed });
  expect((await owner.run(context())).kind).toBe('done'); phase = 'stop'; deleting = true;
  return { ...f, owner, context };
}
describe.skipIf(!available)('sealed original development job resumption (actual PG/factory/controller; controlled digital and node status)', () => {
  test('a completed preparation job resumes private cleanup, waits without blocking controller observation, and retains parent storage', async () => {
    const f = await protectedFixture();
    try {
      f.control.permitted = false;
      expect((await f.owner.run(f.context())).kind).toBe('waiting');
      expect(f.physical.state.deleteRequests).toEqual([]);
      expect((await f.load(f.env.id)).native?.state).toBe('cleaning');
      f.control.permitted = true; f.physical.state.holdPod = true;
      expect((await f.owner.run(f.context())).kind).toBe('waiting');
      expect(f.physical.state.deleteRequests).toContain('Pod:' + f.env.podName);
      expect(f.physical.state.deleteRequests.filter((value) => value.startsWith('Secret:'))).toEqual([]);
      const removed = f.wait('finalizer-removed'), controller = f.controller();
      controller.observer.start(); await removed; await controller.observer.stop();
      expect((await f.safety.get(f.env.render!.workloadConsumerId!))?.stopProof?.podUid).toBe(f.env.native!.podUid);
      await f.physical.finishDeletion();
      expect((await f.owner.run(f.context())).kind).toBe('waiting');
      expect((await f.load(f.env.id)).native?.state).toBe('finished');
      expect(f.physical.state.deleteRequests.filter((value) => value.startsWith('Secret:'))).toHaveLength(2);
      expect((await f.k8s.get(Resources.Pod!, f.parent.podName, f.parent.namespace))?.metadata.uid).toBe(f.parentPod.metadata.uid);
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.parent.pvcName, f.parent.namespace))?.metadata.uid).toBe(f.pvc.metadata.uid);
      expect(f.calls.filter((value) => value === 'materials')).toEqual([]);
    } finally { await f.close(); }
  }, 20_000);
});
