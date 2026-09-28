import { expect, test } from 'bun:test';
import type { WorkloadConsumer, WorkloadStartPermit } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { newResourceId, noopLogger, precondition } from '@crewstation/kernel';
import type { ClusterWriter, ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import { newObservationStats } from './observeChange';
import { applyWorkload } from './workloadApply';

function fixture() {
  const taskId = TaskIdSchema.parse(newResourceId()), calls: string[] = [], id = newResourceId();
  const state = { registered: undefined as WorkloadConsumer | undefined, closed: false, grantFailure: false, scheduled: false, registrationFailure: false,
    permit: null as WorkloadStartPermit | null, lateClose: false };
  const volumeUid = crypto.randomUUID(), permit = { podUid: crypto.randomUUID(), nodeName: 'node-1', nodeUid: crypto.randomUUID() };
  const record: LedgerRecordView = { id: taskId, kind: 'business-workspace', desired: 'present', generation: 1, phase: 'provisioning', children: [], conditions: [{ type: 'Provisioning', status: 'true' }],
    spec: { children: [{ kind: 'Pod', namespace: 'cs-gate', name: 'task-1' }, { kind: 'Secret', namespace: 'cs-gate', name: 'task-1-runner' }], workloadConsumerId: id,
      pod: { image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '1Gi', storage: '1Gi' }, workload: 'business-task', project: 'demo', service: 'demo', pvc: 'work', secret: 'task-1-runner',
        businessStorage: { version: 1, ownerTaskId: taskId, initialize: true }, consumer: { id, taskId, revision: 1, purpose: 'business', finalization: null } } } };
  const feed = { cached: () => ({ kind: 'PersistentVolumeClaim', metadata: { name: 'work', namespace: 'cs-gate', uid: volumeUid } }) } as unknown as ManagedObjectFeed;
  const ledger = { get: async () => record, observeConditions: async () => ({ status: 'recorded' }), workloadSafety: {
    get: async () => state.registered ? { consumer: state.registered, admissionClosed: state.closed, startPermit: state.permit, stopProof: null } : undefined,
    register: async (consumer: WorkloadConsumer) => { calls.push('register'); if (state.registrationFailure) throw new Error('PG unavailable'); state.registered = consumer; return { consumer, admissionClosed: state.closed }; },
    grantStart: async (_id: string, grant: typeof permit) => { calls.push('grant'); if (state.grantFailure || state.closed) throw precondition('admission closed'); state.permit = { ...grant, grantedAt: new Date().toISOString() }; },
  } } as unknown as LedgerObservations;
  const cluster = { inspectWorkloadStart: async () => { calls.push('inspect'); return state.scheduled ? permit : undefined; },
    activateWorkload: async () => { if (!state.permit) throw new Error('missing persisted grant'); calls.push('activate'); },
    ensureRunnerSecret: async () => { calls.push('secret'); return { uid: 'secret', created: true }; },
    ensurePod: async () => { calls.push('pod'); if (state.lateClose) state.closed = true; return { uid: permit.podUid, created: true }; },
  } as unknown as ClusterWriter;
  const deps = { ledger, feed, cluster, logger: noopLogger, stats: newObservationStats(), workloads: { runnerValues: async () => ({}), checkoutValues: async () => ({ token: '' }), bindWorkload: async () => { calls.push('bind'); }, workloadUnavailable: async () => {} } };
  const enqueue = () => { calls.push('retry'); };
  return { deps, record, state, calls, enqueue };
}
test('registration commits before Pod creation; scheduling after bind still activates through a durable grant', async () => {
  const f = fixture();
  await applyWorkload(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['register', 'secret', 'pod', 'bind', 'inspect', 'retry']);
  expect(f.state.registered?.volumeUid).toMatch(/^[0-9a-f-]{36}$/);
  f.calls.length = 0; f.state.scheduled = true;
  await applyWorkload(f.deps, { ...f.record, conditions: [{ type: 'Provisioning', status: 'false' }] }, f.enqueue);
  expect(f.calls).toEqual(['inspect', 'grant', 'activate']);
});
test('registration or grant failures never release the init gate, and retry does not recreate a bound Pod', async () => {
  const f = fixture(); f.state.registrationFailure = true;
  await expect(applyWorkload(f.deps, f.record, f.enqueue)).rejects.toThrow('PG unavailable');
  expect(f.calls).toEqual(['register']);
  f.calls.length = 0; f.state.registrationFailure = false;
  await applyWorkload(f.deps, f.record, f.enqueue);
  f.calls.length = 0; f.state.scheduled = true; f.state.grantFailure = true;
  await expect(applyWorkload(f.deps, { ...f.record, conditions: [] }, f.enqueue)).rejects.toThrow();
  expect(f.calls).toEqual(['inspect', 'grant']);
  f.calls.length = 0; f.state.grantFailure = false;
  await applyWorkload(f.deps, { ...f.record, conditions: [] }, f.enqueue);
  expect(f.calls).toEqual(['inspect', 'grant', 'activate']);
});
test('closure during an in-flight create leaves its Pod behind a closed gate; a later ordinary retry is rejected', async () => {
  const f = fixture(); f.state.lateClose = true; f.state.scheduled = true;
  await applyWorkload(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['register', 'secret', 'pod', 'bind']);
  expect(f.state.permit).toBeNull(); f.calls.length = 0;
  await expect(applyWorkload(f.deps, f.record, f.enqueue)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
  expect(f.calls).toEqual(['register']);
});
