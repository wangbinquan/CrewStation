// 工作卷启动保护（通用部分）：登记了消费者的 Pod 先过只读 UID 门，再挂工作卷；没有消费者的 Pod 原样返回。
// RFC-034 v2 退役了开发用量存储卷与其删除保护（开发 Agent 不再在 Pod 内落数值日志），这里只锁通用门。

import { expect, test } from 'bun:test';
import { TaskIdSchema, WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { taskPodObject } from './task';
import type { K8sObject } from '../resources';
import type { WorkloadAdmissionPod } from './workloadAdmission';
import { assertWorkloadGate, protectWorkloadPod } from './workloadAdmission';
import { k8sObjectCovers } from './coverage';

const id = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
function selection(): WorkloadAdmissionPod {
  return { name: 'agent-pod', namespace: 'cs-project', taskId: id(3), image: 'agent@sha256:image', workerUid: 10001,
    consumer: { id: id(7), taskId: TaskIdSchema.parse(id(2)), revision: 3, purpose: 'agent', finalization: null }, consumerVolumeUid: 'd7aa3cff-94e3-453a-9c04-c6f7a8678438' };
}
function protectedPod(pod = selection()): K8sObject {
  const object = taskPodObject({ name: pod.name, namespace: pod.namespace, taskId: pod.taskId, image: pod.image, workerUid: pod.workerUid,
    workload: 'dev-session', project: 'project', service: 'service', resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workVolume: { pvc: 'work' } });
  return protectWorkloadPod(object, pod);
}

type MutableSpec = { containers: Array<Record<string, unknown>>; initContainers: Array<Record<string, unknown>>; volumes: Array<Record<string, unknown>>; automountServiceAccountToken: boolean };

test('a registered consumer gets a UID-only first gate, the stop finalizer and its own Pod UID; no development stores are rendered', () => {
  const pod = selection(), object = protectedPod(pod), spec = object.spec as MutableSpec;
  expect(object.metadata.finalizers).toEqual([WORKLOAD_STOP_FINALIZER]);
  expect(object.metadata.annotations?.[WORKLOAD_CONSUMER_ANNOTATION]).toBe(pod.consumer!.id);
  expect(spec.initContainers[0]!['volumeMounts']).toEqual([{ name: 'workload-admission', mountPath: '/run/admission', readOnly: true }]);
  expect(spec.automountServiceAccountToken).toBe(false);
  expect((spec.containers[0]!['env'] as Array<{ name: string }>).filter((e) => e.name === 'CS_RUNTIME_POD_UID')).toHaveLength(1);
  expect(spec.volumes.map((v) => v['name'])).not.toContain('development-usage');
  expect(() => assertWorkloadGate(object, pod)).not.toThrow();
});

test('re-reading a protected Pod rejects changed ownership, finalizer, token mount or gate', () => {
  const pod = selection();
  const mutations: Array<(object: K8sObject, spec: MutableSpec) => void> = [
    (o) => { o.metadata.annotations![WORKLOAD_CONSUMER_ANNOTATION] = id(8); },
    (o) => { o.metadata.annotations!['crewstation.io/work-volume-uid'] = crypto.randomUUID(); },
    (o) => { o.metadata.finalizers = []; },
    (_, s) => { s.automountServiceAccountToken = true; },
    (_, s) => { s.initContainers[0]!['volumeMounts'] = [{ name: 'work', mountPath: '/work' }]; },
    (_, s) => { s.initContainers.unshift({ name: 'before-admission' }); },
    (_, s) => { s.volumes.find((v) => v['name'] === 'workload-admission')!['secret'] = { secretName: 'another-admission', optional: true }; },
  ];
  for (const mutate of mutations) {
    const object = protectedPod(pod); mutate(object, object.spec as MutableSpec);
    expect(() => assertWorkloadGate(object, pod)).toThrow();
  }
});

test('a Pod without a consumer is returned unchanged; a consumer without a registered volume is refused', () => {
  const pod = selection(), { consumer: _consumer, ...plain } = pod;
  const object = taskPodObject({ name: pod.name, namespace: pod.namespace, taskId: pod.taskId, image: pod.image, workerUid: pod.workerUid,
    workload: 'dev-session', project: 'project', service: 'service', resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workVolume: { pvc: 'work' } });
  const before = JSON.stringify(object);
  expect(JSON.stringify(protectWorkloadPod(object, plain))).toBe(before);
  expect(() => protectWorkloadPod(object, { ...pod, consumerVolumeUid: undefined })).toThrow();
});

test('the moved subset comparison preserves API defaults, array ordering and exact array lengths', () => {
  expect(k8sObjectCovers({ spec: { extra: true, containers: [{ name: 'runner', extra: true }] } }, { spec: { containers: [{ name: 'runner' }] } })).toBe(true);
  expect(k8sObjectCovers(undefined, [])).toBe(true);
  expect(k8sObjectCovers([{ name: 'runner' }, { name: 'sidecar' }], [{ name: 'runner' }])).toBe(false);
  expect(k8sObjectCovers(['first', 'second'], ['second', 'first'])).toBe(false);
  expect(k8sObjectCovers({ nested: 'original' }, { nested: 'replacement' })).toBe(false);
});
