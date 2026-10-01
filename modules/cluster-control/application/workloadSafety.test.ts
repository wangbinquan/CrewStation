import { expect, test } from 'bun:test';
import type { WorkloadConsumer, WorkloadStopProof } from '@crewstation/contracts';
import { TaskIdSchema, WORKLOAD_CONSUMER_ANNOTATION } from '@crewstation/contracts';
import { fixedClock, newResourceId, noopLogger } from '@crewstation/kernel';
import type { LedgerRecordView } from '../ports/ledger';
import type { ObservedObject } from '../domain/observation';
import { reconcileWorkloadSafety } from './workloadSafety';
import type { WorkloadSafetyDeps } from './workloadSafety';

function fixture() {
  const calls: string[] = [], consumer: WorkloadConsumer = { id: newResourceId(), resourceId: newResourceId(), taskId: TaskIdSchema.parse(newResourceId()), revision: 1,
    namespace: 'cs-test', podName: 'task-1', volumeUid: crypto.randomUUID(), purpose: 'agent', finalization: null };
  const proof: WorkloadStopProof = { id: newResourceId(), consumer, podUid: crypto.randomUUID(), type: 'never-scheduled', nodeName: null, nodeUid: null,
    podResourceVersion: '42', observedAt: '2026-09-28T00:00:00.000Z', containers: [{ kind: 'container', name: 'runner', state: 'never-started', containerId: null, exitCode: null }] };
  const behavior = { failCommit: false, missing: false, unknown: false, saved: null as WorkloadStopProof | null };
  const pod: ObservedObject = { kind: 'Pod', metadata: { name: consumer.podName, namespace: consumer.namespace, uid: proof.podUid,
    annotations: { [WORKLOAD_CONSUMER_ANNOTATION]: consumer.id }, deletionTimestamp: proof.observedAt } };
  const record: LedgerRecordView = { id: consumer.resourceId, kind: 'agent-execution', desired: 'absent', generation: 1, phase: 'stopping', children: [], conditions: [],
    spec: { children: [{ kind: 'Pod', namespace: consumer.namespace, name: consumer.podName }], workloadConsumerId: consumer.id } };
  const deps: WorkloadSafetyDeps = { clock: fixedClock(proof.observedAt), logger: noopLogger, feed: { cached: () => behavior.missing ? undefined : pod },
    ledger: { workloadSafety: { get: async () => ({ consumer, admissionClosed: false, startPermit: null, stopProof: behavior.saved }), closeConsumer: async () => { calls.push('close'); return { consumer, admissionClosed: true, startPermit: null, stopProof: behavior.saved }; }, recordStop: async () => {
      calls.push('commit'); if (behavior.failCommit) throw new Error('database unavailable'); behavior.saved = proof; return proof;
    } }, observeConditions: async (_id, conditions) => { calls.push(`condition:${conditions[0]!.status}`); return { status: 'recorded' }; } },
    cluster: { observeWorkloadStop: async () => { calls.push('observe'); return behavior.unknown ? { state: 'blocked', code: 'unknown-writer' } : { state: 'proved', proof }; }, releaseWorkloadStop: async () => { calls.push('finalizer'); } } };
  return { deps, calls, record, proof, behavior, enqueue: () => { calls.push('retry'); } };
}
test('only a successful durable stop-proof receipt allows finalizer removal; replay uses the saved proof', async () => {
  const f = fixture(); f.behavior.failCommit = true;
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'observe', 'commit', 'condition:unknown', 'retry']);
  f.calls.length = 0; f.behavior.failCommit = false;
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'observe', 'commit', 'finalizer', 'condition:true']);
  f.calls.length = 0; f.behavior.missing = true;
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'finalizer', 'condition:true']);
});
test('unknown writer never removes the protection or reports success; legacy resources keep their existing lifecycle', async () => {
  const f = fixture(); f.behavior.unknown = true;
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'observe', 'condition:unknown', 'retry']);
  f.calls.length = 0; f.behavior.missing = true;
  await reconcileWorkloadSafety(f.deps, { ...f.record, spec: { children: [] } }, f.enqueue);
  expect(f.calls).toEqual([]);
});
test('close re-reads the winning start grant; an earlier unstarted snapshot cannot certify a missing writer', async () => {
  const f = fixture();
  const consumer = f.proof.consumer, permit = { podUid: f.proof.podUid, nodeName: 'node-1', nodeUid: crypto.randomUUID(), grantedAt: f.proof.observedAt };
  f.deps.ledger.workloadSafety!.closeConsumer = async () => { f.calls.push('close'); return { consumer, admissionClosed: true, startPermit: permit, stopProof: null }; };
  f.deps.cluster.observeWorkloadStop = async () => { f.calls.push('observe'); return { state: 'blocked', code: 'pod_missing_without_stop_proof' }; };
  f.behavior.missing = true;
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'observe', 'condition:unknown', 'retry']);
});
test('durably closed, never-admitted consumers need no fabricated Pod proof', async () => {
  const f = fixture(); f.behavior.missing = true;
  f.deps.cluster.observeWorkloadStop = async () => { f.calls.push('observe'); return { state: 'blocked', code: 'pod_missing_without_stop_proof' }; };
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'observe', 'condition:true']);
  f.calls.length = 0;
  f.deps.ledger.workloadSafety!.get = async () => undefined;
  f.deps.ledger.workloadSafety!.admissionClosed = async () => true;
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['condition:true']);
});

// RFC-034: physical stop alone cannot close the Controller finalizer while the digital copy waits.
test('a digital finalizer refusal stays unknown and retries without discarding the saved physical proof', async () => {
  const f = fixture(); f.behavior.saved = f.proof;
  f.deps.cluster.releaseWorkloadStop = async () => { f.calls.push('finalizer-waiting'); return { kind: 'waiting', reason: 'development-removal-evidence-pending' }; };
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'finalizer-waiting', 'condition:unknown', 'retry']);
  expect(f.behavior.saved).toBe(f.proof);
  f.calls.length = 0;
  f.deps.cluster.releaseWorkloadStop = async () => { f.calls.push('finalizer'); };
  await reconcileWorkloadSafety(f.deps, f.record, f.enqueue);
  expect(f.calls).toEqual(['close', 'finalizer', 'condition:true']);
});
