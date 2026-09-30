import { expect, test } from 'bun:test';
import { TaskIdSchema, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { taskPodObject } from './task';
import type { K8sObject } from '../resources';
import type { WorkloadAdmissionPod } from './workloadAdmission';
import { assertWorkloadGate, protectWorkloadPod } from './workloadAdmission';
import { k8sObjectCovers } from './coverage';

const id = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
function selection(): WorkloadAdmissionPod {
  const parent = TaskIdSchema.parse(id(2)), volumeUid = 'd7aa3cff-94e3-453a-9c04-c6f7a8678438';
  return { name: 'original-agent', namespace: 'cs-original', taskId: id(3), image: 'agent@sha256:original', workerUid: 10001,
    consumer: { id: id(7), taskId: parent, revision: 3, purpose: 'agent', finalization: null }, consumerVolumeUid: volumeUid, expectedVolumeUid: volumeUid,
    developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 }, workload: 'dev-session', pvc: 'original-work', nodeName: 'original-node', secret: 'original-runner-3',
    workspace: { pod: 'original-parent', podUid: 'd624eb08-2bfa-46f6-812f-29bdecc0d961', pvcUid: volumeUid },
    resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, labels: { 'crewstation.io/workspace-task': parent }, annotations: { 'crewstation.io/cli-intent': 'a'.repeat(64) } };
}
function protectedPod(pod = selection()): K8sObject {
  const object = taskPodObject({ name: pod.name, namespace: pod.namespace, taskId: pod.taskId, image: pod.image, workerUid: pod.workerUid,
    workload: 'dev-session', project: 'project', service: 'service', resources: pod.resources!, workVolume: { pvc: pod.pvc! }, envFromSecret: pod.secret, nodeName: pod.nodeName,
    developmentUsageStorage: pod.developmentUsageStorage, labels: pod.labels });
  object.metadata.annotations = { ...pod.annotations };
  return protectWorkloadPod(object, pod);
}

test('a protected original Pod keeps both disk stores and a UID-only first gate; scheduler defaults are accepted', () => {
  const pod = selection(), object = protectedPod(pod);
  expect(object.metadata.finalizers).toEqual([WORKLOAD_STOP_FINALIZER]);
  const spec = object.spec as { nodeName?: string; initContainers: Array<{ volumeMounts: unknown[]; resources: unknown }> };
  expect(spec.initContainers[0]!.volumeMounts).toEqual([{ name: 'workload-admission', mountPath: '/run/admission', readOnly: true }]);
  spec.nodeName = pod.nodeName;
  spec.initContainers[0]!.resources = { requests: { cpu: '0.01', memory: '64Mi' }, limits: { cpu: '0.5', memory: '256Mi' } };
  expect(() => assertWorkloadGate(object, pod)).not.toThrow();
});

type MutableSpec = { containers: Array<Record<string, unknown>>; initContainers: Array<Record<string, unknown>>; volumes: Array<Record<string, unknown>>; affinity: unknown; nodeName?: string; automountServiceAccountToken: boolean };
test('re-reading a selected Pod rejects changed ownership, permission, private stores, Runner UID, image, resource, Secret or node', () => {
  const pod = selection();
  const mutations: Array<(object: K8sObject, spec: MutableSpec) => void> = [
    (o) => { o.metadata.annotations!['crewstation.io/workload-consumer'] = id(8); },
    (o) => { o.metadata.annotations!['crewstation.io/work-volume-uid'] = crypto.randomUUID(); },
    (o) => { o.metadata.labels!['crewstation.io/workspace-task'] = id(8); },
    (o) => { o.metadata.annotations!['crewstation.io/cli-intent'] = 'b'.repeat(64); },
    (o) => { o.metadata.finalizers = []; },
    (_, s) => { s.automountServiceAccountToken = true; },
    (_, s) => { s.initContainers[0]!['volumeMounts'] = [{ name: 'work', mountPath: '/work' }]; },
    (_, s) => { s.initContainers.unshift({ name: 'before-admission' }); },
    (_, s) => { s.volumes.find((v) => v['name'] === 'workload-admission')!['secret'] = { secretName: 'another-admission', optional: true }; },
    (_, s) => { s.volumes.find((v) => v['name'] === 'development-usage')!['emptyDir'] = { medium: 'Memory' }; },
    (_, s) => { s.volumes.find((v) => v['name'] === 'development-usage-binding')!['emptyDir'] = { medium: 'Memory' }; },
    (_, s) => { s.volumes.push({ name: 'development-usage', emptyDir: {} }); },
    (_, s) => { s.volumes.find((v) => v['name'] === 'work')!['persistentVolumeClaim'] = { claimName: 'replacement-work' }; },
    (_, s) => { (s.containers[0]!['volumeMounts'] as Array<Record<string, unknown>>).find((m) => m['name'] === 'development-usage')!['readOnly'] = true; },
    (_, s) => { (s.containers[0]!['volumeMounts'] as Array<Record<string, unknown>>).find((m) => m['name'] === 'development-usage-binding')!['subPath'] = 'another-agent'; },
    (_, s) => { (s.containers[0]!['volumeMounts'] as unknown[]).push({ name: 'alias', mountPath: '/run/crewstation/development-usage' }); },
    (_, s) => { s.containers[0]!['env'] = [{ name: 'CS_RUNTIME_POD_UID', value: 'replacement-pod' }]; },
    (_, s) => { (s.containers[0]!['env'] as unknown[]).push({ name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } }); },
    (_, s) => { s.containers[0]!['envFrom'] = [{ secretRef: { name: 'replacement-runner' } }]; },
    (_, s) => { s.containers[0]!['image'] = 'replacement-image'; },
    (_, s) => { s.containers[0]!['resources'] = { requests: { cpu: '2', memory: '2Gi', 'ephemeral-storage': '10Gi' }, limits: { cpu: '2', memory: '2Gi', 'ephemeral-storage': '10Gi' } }; },
    (_, s) => { s.affinity = {}; },
    (_, s) => { s.nodeName = 'replacement-node'; },
  ];
  for (const mutate of mutations) {
    const object = protectedPod(pod); mutate(object, object.spec as MutableSpec);
    expect(() => assertWorkloadGate(object, pod)).toThrow();
  }
});

test('an explicit malformed or incomplete selection cannot disappear through the ordinary no-consumer branch', () => {
  const pod = selection();
  for (const patch of [
    { developmentUsageProtection: null }, { developmentUsageProtection: { version: 2 } }, { developmentUsageProtection: { version: 1, extra: true } },
    { developmentUsageStorage: undefined }, { consumer: undefined }, { consumerVolumeUid: undefined }, { expectedVolumeUid: crypto.randomUUID() },
    { workspace: { ...pod.workspace!, podUid: 'not-a-uid' } }, { labels: {} }, { annotations: {} }, { secret: undefined }, { resources: undefined },
    { consumer: { ...pod.consumer!, taskId: pod.taskId } }, { consumer: { ...pod.consumer!, purpose: 'business' } },
  ]) expect(() => protectedPod({ ...pod, ...patch } as WorkloadAdmissionPod)).toThrow();
});

test('the moved subset comparison preserves API defaults, array ordering and exact array lengths', () => {
  expect(k8sObjectCovers({ spec: { extra: true, containers: [{ name: 'runner', extra: true }] } }, { spec: { containers: [{ name: 'runner' }] } })).toBe(true);
  expect(k8sObjectCovers(undefined, [])).toBe(true);
  expect(k8sObjectCovers([{ name: 'runner' }, { name: 'sidecar' }], [{ name: 'runner' }])).toBe(false);
  expect(k8sObjectCovers(['first', 'second'], ['second', 'first'])).toBe(false);
  expect(k8sObjectCovers({ nested: 'original' }, { nested: 'replacement' })).toBe(false);
});

// Kubernetes defaults ObjectFieldSelector.apiVersion to v1 when the Pod is read back.
test('Kubernetes defaulted UID references retain admission; other versions, paths and sources still fail', () => {
  const pod = selection(), object = protectedPod(pod), spec = object.spec as MutableSpec;
  for (const container of [spec.containers[0]!, spec.initContainers[0]!]) {
    const entry = (container['env'] as Array<{ name: string; valueFrom: { fieldRef: Record<string, unknown> } }>).find((e) => e.name.endsWith('POD_UID'))!;
    entry.valueFrom.fieldRef['apiVersion'] = 'v1';
  }
  expect(() => assertWorkloadGate(object, pod)).not.toThrow();
  for (const entry of [
    { name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { apiVersion: 'v2', fieldPath: 'metadata.uid' } } },
    { name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.name' } } },
    { name: 'CS_RUNTIME_POD_UID', value: 'literal', valueFrom: { fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.uid' } } },
    { name: 'CS_RUNTIME_POD_UID', valueFrom: { secretKeyRef: { name: 'replacement', key: 'podUid' }, fieldRef: { apiVersion: 'v1', fieldPath: 'metadata.uid' } } },
  ]) {
    const invalid = protectedPod(pod);
    (invalid.spec as MutableSpec).containers[0]!['env'] = [entry];
    expect(() => assertWorkloadGate(invalid, pod)).toThrow();
    const invalidInit = protectedPod(pod);
    (invalidInit.spec as MutableSpec).initContainers[0]!['env'] = [{ ...entry, name: 'CS_ADMISSION_POD_UID' }];
    expect(() => assertWorkloadGate(invalidInit, pod)).toThrow();
  }
});
