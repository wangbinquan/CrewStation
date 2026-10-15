import type { WorkloadConsumerIntent } from '@crewstation/contracts';
import { WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { K8sObject } from '../resources';
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
}

const VOLUME_ANNOTATION = 'crewstation.io/work-volume-uid';
const gateScript = 'set -eu\nwhile :; do\n  if [ -r /run/admission/podUid ] && [ "$(cat /run/admission/podUid)" = "$CS_ADMISSION_POD_UID" ]; then exit 0; fi\n  sleep 1\ndone';
type PodSpec = { volumes: Array<Record<string, unknown>>; initContainers?: Array<Record<string, unknown>>; containers: Array<Record<string, unknown>>; automountServiceAccountToken?: boolean };

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

/** This first init has no work mount. All storage initialization and user processes remain behind it. */
export function protectWorkloadPod(object: K8sObject, pod: WorkloadAdmissionPod): K8sObject {
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
  return object;
}
export function assertWorkloadGate(object: K8sObject, pod: WorkloadAdmissionPod): void {
  const spec = object.spec as PodSpec, actual = spec.initContainers?.[0], expected = gate(pod);
  if (!pod.consumer || !pod.consumerVolumeUid || object.metadata.name !== pod.name || object.metadata.namespace !== pod.namespace
    || object.metadata.annotations?.[WORKLOAD_CONSUMER_ANNOTATION] !== pod.consumer.id || object.metadata.annotations?.[VOLUME_ANNOTATION] !== pod.consumerVolumeUid
    || !object.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER) || object.metadata.labels?.[LABELS.task] !== pod.taskId || spec.automountServiceAccountToken !== false
    || !actual || Object.keys(expected).filter((k) => k !== 'resources').some((k) => !covers(actual[k], expected[k as keyof typeof expected]))
    || !spec.volumes.some((v) => covers(v, gateVolume(pod)))) throw conflict('Pod 未具备匹配的工作卷启动保护');
}
