import type { WorkloadStartPermit } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { assertWorkloadGate, LABELS, Resources, secretObject } from '@crewstation/k8s';
import { conflict, precondition } from '@crewstation/kernel';
import type { WorkloadPodRender } from '../../../domain/workloadRender';
import { nodeEvidence } from './workloadStop';

export { assertWorkloadGate, protectWorkloadPod } from '@crewstation/k8s';
type PodSpec = { nodeName?: string };

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
