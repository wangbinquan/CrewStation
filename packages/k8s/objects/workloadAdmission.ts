import { isDeepStrictEqual } from 'node:util';
import type { DevelopmentUsageStorage, WorkloadConsumerIntent } from '@crewstation/contracts';
import { DEVELOPMENT_USAGE_BINDING_DIRECTORY, DEVELOPMENT_USAGE_DIRECTORY, DevelopmentUsageStorageSchema, WorkloadConsumerSchema, WorkloadStartPermitSchema, WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { K8sObject } from '../resources';
import { resourcesMatch } from '../quantities';
import { LABELS } from './labels';
import { k8sObjectCovers as covers } from './coverage';

/** Pure rendering data; a constructed gate never substitutes for durable registration or grantStart. */
export interface WorkloadAdmissionPod {
  readonly name: string;
  readonly namespace: string;
  readonly taskId: string;
  readonly image: string;
  readonly workerUid: number;
  readonly consumer?: WorkloadConsumerIntent;
  readonly consumerVolumeUid?: string;
  readonly developmentUsageProtection?: { readonly version: 1 };
  readonly developmentUsageStorage?: DevelopmentUsageStorage;
  readonly workload?: string;
  readonly expectedVolumeUid?: string;
  readonly pvc?: string;
  readonly nodeName?: string;
  readonly workspace?: { readonly pod: string; readonly podUid: string; readonly pvcUid: string };
  readonly parentPodUid?: string;
  readonly secret?: string;
  readonly resources?: { readonly cpu: string; readonly memory: string; readonly storage: string };
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

const VOLUME_ANNOTATION = 'crewstation.io/work-volume-uid';
const gateScript = 'set -eu\nwhile :; do\n  if [ -r /run/admission/podUid ] && [ "$(cat /run/admission/podUid)" = "$CS_ADMISSION_POD_UID" ]; then exit 0; fi\n  sleep 1\ndone';
type PodSpec = { volumes: Array<Record<string, unknown>>; initContainers?: Array<Record<string, unknown>>; containers: Array<Record<string, unknown>>; nodeName?: string; affinity?: unknown; automountServiceAccountToken?: boolean };

function gate(pod: WorkloadAdmissionPod) {
  const entry = pod.consumer?.purpose === 'archive' ? 'archive-helper' : 'task-runner';
  const check = '/opt/crewstation/bin/' + entry + ' storage-contract 1 >/dev/null';
  return { name: 'workload-admission', image: pod.image, command: ['/bin/sh', '-c', 'set -eu\n' + check + '\n' + gateScript],
    env: [{ name: 'CS_ADMISSION_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } }],
    volumeMounts: [{ name: 'workload-admission', mountPath: '/run/admission', readOnly: true }],
    securityContext: { runAsUser: pod.workerUid, runAsGroup: pod.workerUid, runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
    resources: { requests: { cpu: '10m', memory: '64Mi' }, limits: { cpu: '500m', memory: '256Mi' } } };
}
function gateVolume(pod: WorkloadAdmissionPod) { return { name: 'workload-admission', secret: { secretName: pod.name + '-admission', optional: true } }; }

function assertDevelopmentSelection(pod: WorkloadAdmissionPod): void {
  if (pod.developmentUsageProtection === undefined) return;
  const consumer = pod.consumer, parentUid = pod.workspace?.podUid ?? pod.parentPodUid;
  if (!DevelopmentUsageStorageSchema.safeParse(pod.developmentUsageProtection).success || !DevelopmentUsageStorageSchema.safeParse(pod.developmentUsageStorage).success
    || pod.workload !== 'dev-session' || !pod.pvc || !pod.nodeName || !pod.secret || !pod.resources || !consumer || consumer.purpose !== 'agent' || consumer.finalization !== null
    || consumer.taskId === pod.taskId || pod.labels?.['crewstation.io/workspace-task'] !== consumer.taskId
    || !/^[0-9a-f]{64}$/.test(pod.annotations?.['crewstation.io/cli-intent'] ?? '') || !WorkloadStartPermitSchema.shape.podUid.safeParse(parentUid).success
    || pod.workspace && (!pod.workspace.pod || pod.workspace.pvcUid !== pod.expectedVolumeUid)
    || pod.expectedVolumeUid !== pod.consumerVolumeUid || !WorkloadConsumerSchema.safeParse({ ...consumer, resourceId: pod.taskId, namespace: pod.namespace, podName: pod.name, volumeUid: pod.expectedVolumeUid }).success) {
    throw precondition('独立开发 Agent 的原工作卷保护快照不完整或冲突');
  }
}

function diskStore(spec: PodSpec, container: Record<string, unknown>, name: string, directory: string): boolean {
  const volumes = spec.volumes.filter((v) => v['name'] === name);
  const mounts = (container['volumeMounts'] ?? []) as Array<Record<string, unknown>>;
  const at = mounts.filter((m) => m['name'] === name || m['mountPath'] === directory);
  return volumes.length === 1 && isDeepStrictEqual(volumes[0], { name, emptyDir: {} })
    && at.length === 1 && at[0]?.['name'] === name && at[0]?.['mountPath'] === directory && at[0]?.['readOnly'] !== true && at[0]?.['subPath'] === undefined && at[0]?.['subPathExpr'] === undefined;
}
function ownPodUid(entry: Record<string, unknown> | undefined, name: string): boolean {
  const source = entry?.['valueFrom'] as Record<string, unknown> | undefined, field = source?.['fieldRef'];
  if (!field || typeof field !== 'object' || Array.isArray(field)) return false;
  const selector = { ...field } as Record<string, unknown>;
  if (selector['apiVersion'] !== undefined && selector['apiVersion'] !== 'v1') return false;
  delete selector['apiVersion'];
  return isDeepStrictEqual({ ...entry, valueFrom: { ...source, fieldRef: selector } }, { name, valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } });
}
function developmentStoresMatch(spec: PodSpec, pod: WorkloadAdmissionPod): boolean {
  const container = spec.containers[0], volumes = spec.volumes.filter((v) => v['name'] === 'work');
  if (!container || spec.containers.length !== 1 || spec.initContainers?.length !== 1 || container['image'] !== pod.image || !pod.resources) return false;
  const env = (container['env'] ?? []) as Array<Record<string, unknown>>, uids = env.filter((e) => e['name'] === 'CS_RUNTIME_POD_UID');
  const mounts = (container['volumeMounts'] ?? []) as Array<Record<string, unknown>>, work = mounts.filter((m) => m['name'] === 'work' || m['mountPath'] === '/work');
  return volumes.length === 1 && covers(volumes[0], { name: 'work', persistentVolumeClaim: { claimName: pod.pvc } })
    && work.length === 1 && work[0]?.['name'] === 'work' && work[0]?.['mountPath'] === '/work' && work[0]?.['readOnly'] !== true && work[0]?.['subPath'] === undefined && work[0]?.['subPathExpr'] === undefined
    && diskStore(spec, container, 'development-usage', DEVELOPMENT_USAGE_DIRECTORY) && diskStore(spec, container, 'development-usage-binding', DEVELOPMENT_USAGE_BINDING_DIRECTORY)
    && uids.length === 1 && ownPodUid(uids[0], 'CS_RUNTIME_POD_UID')
    && ownPodUid((spec.initContainers[0]!['env'] as Array<Record<string, unknown>>)[0], 'CS_ADMISSION_POD_UID')
    && isDeepStrictEqual(container['envFrom'], [{ secretRef: { name: pod.secret } }])
    && resourcesMatch(container['resources'], { cpu: pod.resources.cpu, memory: pod.resources.memory, 'ephemeral-storage': pod.resources.storage })
    && (spec.nodeName === undefined || spec.nodeName === pod.nodeName)
    && isDeepStrictEqual(spec.affinity, { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: [pod.nodeName] }] }] } } })
    && spec.volumes.filter((v) => v['name'] === 'workload-admission').length === 1;
}

/** This first init has no work mount. All storage initialization and user processes remain behind it. */
export function protectWorkloadPod(object: K8sObject, pod: WorkloadAdmissionPod): K8sObject {
  assertDevelopmentSelection(pod);
  if (!pod.consumer) return object;
  if (!pod.consumerVolumeUid) throw precondition('工作卷消费者尚未登记');
  const spec = object.spec as PodSpec;
  object.metadata.annotations = { ...object.metadata.annotations, [WORKLOAD_CONSUMER_ANNOTATION]: pod.consumer.id, [VOLUME_ANNOTATION]: pod.consumerVolumeUid };
  object.metadata.finalizers = [...object.metadata.finalizers ?? [], WORKLOAD_STOP_FINALIZER];
  spec.initContainers = [gate(pod), ...spec.initContainers ?? []]; spec.volumes.push(gateVolume(pod));
  for (const container of spec.containers) {
    const env = (container['env'] ?? []) as Array<{ name: string }>;
    container['env'] = [...env.filter((e) => e.name !== 'CS_RUNTIME_POD_UID'), { name: 'CS_RUNTIME_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } }];
  }
  spec.automountServiceAccountToken = false;
  if (pod.developmentUsageProtection !== undefined) assertWorkloadGate(object, pod);
  return object;
}
export function assertWorkloadGate(object: K8sObject, pod: WorkloadAdmissionPod): void {
  assertDevelopmentSelection(pod);
  const spec = object.spec as PodSpec, actual = spec.initContainers?.[0], expected = gate(pod);
  if (!pod.consumer || !pod.consumerVolumeUid || object.metadata.name !== pod.name || object.metadata.namespace !== pod.namespace
    || object.metadata.annotations?.[WORKLOAD_CONSUMER_ANNOTATION] !== pod.consumer.id || object.metadata.annotations?.[VOLUME_ANNOTATION] !== pod.consumerVolumeUid
    || !object.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER) || object.metadata.labels?.[LABELS.task] !== pod.taskId || spec.automountServiceAccountToken !== false
    || !actual || Object.keys(expected).filter((k) => k !== 'resources').some((k) => !covers(actual[k], expected[k as keyof typeof expected]))
    || !spec.volumes.some((v) => covers(v, gateVolume(pod)))
    || pod.developmentUsageProtection !== undefined && (!developmentStoresMatch(spec, pod)
      || !covers(object.metadata.labels, pod.labels) || !covers(object.metadata.annotations, pod.annotations))) throw conflict('Pod 未具备匹配的工作卷启动保护');
}
