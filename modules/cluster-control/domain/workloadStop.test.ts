import { describe, expect, test } from 'bun:test';
import type { WorkloadConsumer } from '@crewstation/contracts';
import { TaskIdSchema, WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER, WorkloadStopProofSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { ObservedObject } from './observation';
import { classifyWorkloadStop } from './workloadStop';

const now = new Date('2026-09-28T02:00:00.000Z');
const consumer: WorkloadConsumer = { id: newResourceId(), resourceId: newResourceId(), taskId: TaskIdSchema.parse(newResourceId()), revision: 1, namespace: 'cs-test', podName: 'task-one',
  volumeUid: crypto.randomUUID(), purpose: 'business', finalization: null };
const node = { name: 'worker-one', uid: crypto.randomUUID(), ready: true, leaseFresh: true, kubeletVersion: 'v1.34.1+k3s1' };
const ended = (name: string) => ({ name, containerID: `containerd://${name}`, restartCount: 0, state: { terminated: { exitCode: 0, finishedAt: now.toISOString(), containerID: `containerd://${name}` } } });
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const pod = (): Omit<Mutable<ObservedObject>, 'metadata'> & { metadata: Mutable<ObservedObject['metadata']> } => ({ kind: 'Pod', metadata: { name: consumer.podName, namespace: consumer.namespace, uid: crypto.randomUUID(), resourceVersion: '7',
  annotations: { [WORKLOAD_CONSUMER_ANNOTATION]: consumer.id }, finalizers: [WORKLOAD_STOP_FINALIZER, 'example.com/retention'] },
  spec: { nodeName: node.name, containers: [{ name: 'runner' }], initContainers: [{ name: 'init' }, { name: 'sidecar', restartPolicy: 'Always' }], ephemeralContainers: [{ name: 'debug' }] },
  status: { phase: 'Succeeded', initContainerStatuses: [ended('init'), ended('sidecar')], containerStatuses: [ended('runner')], ephemeralContainerStatuses: [ended('debug')] } });

describe('workload stop evidence includes every possible container', () => {
  test('normal termination binds Pod, node, resource version and every init/main/sidecar/debug instance', () => {
    const p = pod(), result = classifyWorkloadStop(consumer, p, node, now);
    expect(result.state).toBe('proved');
    if (result.state !== 'proved') throw new Error(result.code);
    expect(WorkloadStopProofSchema.safeParse(result.proof).success).toBe(true);
    expect(result.proof).toMatchObject({ consumer, type: 'kubelet-terminated', podUid: p.metadata.uid, nodeUid: node.uid, podResourceVersion: '7' });
    expect(result.proof.containers.map((c) => c.name)).toEqual(['init', 'sidecar', 'runner', 'debug']);
  });
  test('API missing, unprotected observation, unsupported kubelet and stale/lost/replaced node do not prove stop', () => {
    expect(classifyWorkloadStop(consumer, undefined, node, now)).toEqual({ state: 'blocked', code: 'pod_missing_without_stop_proof' });
    const p = pod(); p.metadata.finalizers = [];
    expect(classifyWorkloadStop(consumer, p, node, now)).toMatchObject({ state: 'blocked' });
    for (const patch of [{ ready: false }, { leaseFresh: false }, { name: 'replacement' }, { kubeletVersion: 'v1.26.0' }]) expect(classifyWorkloadStop(consumer, pod(), { ...node, ...patch }, now)).toMatchObject({ state: 'blocked' });
    p.metadata.finalizers = [WORKLOAD_STOP_FINALIZER]; p['status'] = { phase: 'Failed', reason: 'NodeLost' };
    expect(classifyWorkloadStop(consumer, p, node, now)).toMatchObject({ state: 'blocked' });
  });
  test('a running sidecar, missing debug state, ambiguous terminated status, or extra undeclared container blocks', () => {
    for (const patch of [
      { initContainerStatuses: [ended('init'), { name: 'sidecar', state: { running: {} } }] },
      { ephemeralContainerStatuses: [] },
      { containerStatuses: [{ ...ended('runner'), state: { terminated: { exitCode: 137, reason: 'ContainerStatusUnknown' } } }] },
      { containerStatuses: [ended('runner'), ended('intruder')] },
      { containerStatuses: [ended('runner'), ended('runner')] },
    ]) {
      const p = pod(); p['status'] = { ...p['status'] as object, ...patch };
      expect(classifyWorkloadStop(consumer, p, node, now)).toMatchObject({ state: 'blocked', code: 'container_stop_observation_incomplete' });
    }
  });
  test('never scheduled needs a deleting protected Pod without any running history', () => {
    const p = pod(); p['spec'] = { containers: [{ name: 'runner' }] }; p['status'] = { phase: 'Pending' };
    expect(classifyWorkloadStop(consumer, p, undefined, now)).toMatchObject({ state: 'blocked' });
    p.metadata.deletionTimestamp = now.toISOString();
    const proved = classifyWorkloadStop(consumer, p, undefined, now);
    expect(proved).toMatchObject({ state: 'proved', proof: { type: 'never-scheduled', nodeUid: null, containers: [{ state: 'never-started' }] } });
    p['status'] = { containerStatuses: [ended('runner')] };
    expect(classifyWorkloadStop(consumer, p, undefined, now)).toMatchObject({ state: 'blocked' });
  });
  test('image/init failure distinguishes never-started containers only after kubelet terminated the Pod and sandbox', () => {
    const p = pod(); p['spec'] = { nodeName: node.name, containers: [{ name: 'runner' }], initContainers: [{ name: 'init' }] };
    p['status'] = { phase: 'Failed', initContainerStatuses: [ended('init')], containerStatuses: [{ name: 'runner', restartCount: 0, state: { waiting: { reason: 'PodInitializing' } } }] };
    expect(classifyWorkloadStop(consumer, p, node, now)).toMatchObject({ state: 'blocked' });
    p['status'] = { ...p['status'] as object, conditions: [{ type: 'PodReadyToStartContainers', status: 'False' }] };
    expect(classifyWorkloadStop(consumer, p, node, now)).toMatchObject({ state: 'proved', proof: { containers: [{ state: 'terminated' }, { state: 'never-started' }] } });
    p['status'] = { ...p['status'] as object, containerStatuses: [{ name: 'runner', restartCount: 1, state: { waiting: {} } }] };
    expect(classifyWorkloadStop(consumer, p, node, now)).toMatchObject({ state: 'blocked' });
  });
});
