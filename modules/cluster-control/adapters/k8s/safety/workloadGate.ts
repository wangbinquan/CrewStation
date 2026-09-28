import type { WorkloadStartPermit } from '@crewstation/contracts';
import { WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, secretObject } from '@crewstation/k8s';
import { conflict, precondition } from '@crewstation/kernel';
import { covers } from '../coverage';
import type { WorkloadPodRender } from '../../../domain/workloadRender';
import { nodeEvidence } from './workloadStop';

const VOLUME_ANNOTATION = 'crewstation.io/work-volume-uid';
const gateScript = 'set -eu\nwhile :; do\n  if [ -r /run/admission/podUid ] && [ "$(cat /run/admission/podUid)" = "$CS_ADMISSION_POD_UID" ]; then exit 0; fi\n  sleep 1\ndone';
type PodSpec = { volumes: Array<Record<string, unknown>>; initContainers?: Array<Record<string, unknown>>; containers: Array<Record<string, unknown>>; nodeName?: string; automountServiceAccountToken?: boolean };
function gate(pod: WorkloadPodRender) {
  const entry = pod.consumer?.purpose === 'archive' ? 'archive-helper' : 'task-runner';
  const check = `/opt/crewstation/bin/${entry} storage-contract 1 >/dev/null`;
  return { name: 'workload-admission', image: pod.image, command: ['/bin/sh', '-c', `set -eu\n${check}\n${gateScript}`],
    env: [{ name: 'CS_ADMISSION_POD_UID', valueFrom: { fieldRef: { fieldPath: 'metadata.uid' } } }],
    volumeMounts: [{ name: 'workload-admission', mountPath: '/run/admission', readOnly: true }],
    securityContext: { runAsUser: pod.workerUid, runAsGroup: pod.workerUid, runAsNonRoot: true, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
    resources: { requests: { cpu: '10m', memory: '64Mi' }, limits: { cpu: '500m', memory: '256Mi' } } };
}
function gateVolume(pod: WorkloadPodRender) { return { name: 'workload-admission', secret: { secretName: `${pod.name}-admission`, optional: true } }; }

/** This first init has no work mount. All storage initialization and user processes remain behind it. */
export function protectWorkloadPod(object: K8sObject, pod: WorkloadPodRender): K8sObject {
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
export function assertWorkloadGate(object: K8sObject, pod: WorkloadPodRender): void {
  const spec = object.spec as PodSpec, actual = spec.initContainers?.[0], expected = gate(pod);
  if (!pod.consumer || !pod.consumerVolumeUid || object.metadata.name !== pod.name || object.metadata.namespace !== pod.namespace
    || object.metadata.annotations?.[WORKLOAD_CONSUMER_ANNOTATION] !== pod.consumer.id || object.metadata.annotations?.[VOLUME_ANNOTATION] !== pod.consumerVolumeUid
    || !object.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER) || object.metadata.labels?.[LABELS.task] !== pod.taskId || spec.automountServiceAccountToken !== false
    || !actual || Object.keys(expected).filter((k) => k !== 'resources').some((k) => !covers(actual[k], expected[k as keyof typeof expected]))
    || !spec.volumes.some((v) => covers(v, gateVolume(pod)))) throw conflict('Pod 未具备匹配的工作卷启动保护');
}
export async function inspectWorkloadStart(k8s: K8sClient, pod: WorkloadPodRender): Promise<Omit<WorkloadStartPermit, 'grantedAt'> | undefined> {
  const signal = AbortSignal.timeout(15_000), object = await k8s.get<K8sObject>(Resources.Pod!, pod.name, pod.namespace, signal);
  if (!object || object.metadata.deletionTimestamp) return undefined;
  assertWorkloadGate(object, pod);
  const spec = object.spec as PodSpec, phase = (object['status'] as { phase?: string } | undefined)?.phase;
  if (!spec.nodeName || !object.metadata.uid || phase === 'Failed' || phase === 'Succeeded') return undefined;
  const volume = pod.pvc && await k8s.get(Resources.PersistentVolumeClaim!, pod.pvc, pod.namespace, signal);
  if (!volume || volume.metadata.uid !== pod.consumerVolumeUid || volume.metadata.deletionTimestamp || volume.metadata.labels?.[LABELS.task] !== pod.consumer!.taskId) throw precondition('启动许可的原工作卷不再有效');
  if ((volume['status'] as { phase?: string } | undefined)?.phase !== 'Bound') return undefined;
  const node = await nodeEvidence(k8s, spec.nodeName, new Date(), signal);
  if (!node?.ready || !node.leaseFresh || Number(/^v1\.(\d+)\./.exec(node.kubeletVersion)?.[1] ?? 0) < 27) return undefined;
  return { podUid: object.metadata.uid, nodeName: node.name, nodeUid: node.uid };
}
/** Called only after grantStart commits. A late secret can unlock only this Pod UID, never a replacement. */
export async function activateWorkload(k8s: K8sClient, pod: WorkloadPodRender, permit: Omit<WorkloadStartPermit, 'grantedAt'>): Promise<void> {
  const name = `${pod.name}-admission`, values = { podUid: permit.podUid, nodeUid: permit.nodeUid, consumerId: pod.consumer!.id, volumeUid: pod.consumerVolumeUid! };
  const desired = { ...secretObject({ name, namespace: pod.namespace, stringData: values, labels: { [LABELS.task]: pod.taskId } }), immutable: true };
  const found = await k8s.get<K8sObject>(Resources.Secret!, name, pod.namespace);
  if (!found) { try { await k8s.create(desired); return; } catch (e) { if (!(e instanceof Error) || !('kind' in e) || e.kind !== 'conflict') throw e; } }
  const stored = found ?? await k8s.get<K8sObject>(Resources.Secret!, name, pod.namespace);
  const data = stored?.['data'] as Record<string, string> | undefined, plain = stored?.['stringData'] as Record<string, string> | undefined;
  if (!stored || stored['immutable'] !== true || stored.metadata.labels?.[LABELS.task] !== pod.taskId || Object.entries(values).some(([key, value]) => (plain?.[key] ?? (data?.[key] ? Buffer.from(data[key], 'base64').toString() : undefined)) !== value)) throw conflict('启动许可 Secret 已由其他消费者占用');
}
