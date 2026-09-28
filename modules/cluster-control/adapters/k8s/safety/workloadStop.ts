import type { WorkloadConsumer, WorkloadStopProof } from '@crewstation/contracts';
import { WORKLOAD_CONSUMER_ANNOTATION, WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { conflict } from '@crewstation/kernel';
import { classifyWorkloadStop } from '../../../domain/workloadStop';
import type { StopNodeEvidence, WorkloadStopObservation } from '../../../domain/workloadStop';

const NODE_LEASE_FRESH_MS = 40_000;
export async function nodeEvidence(k8s: K8sClient, name: string, now: Date, signal: AbortSignal): Promise<StopNodeEvidence | undefined> {
  const node = await k8s.get(Resources.Node!, name, undefined, signal);
  if (!node?.metadata.uid) return undefined;
  const lease = await k8s.get(Resources.Lease!, name, 'kube-node-lease', signal);
  const status = node['status'] as { conditions?: Array<{ type: string; status: string }>; nodeInfo?: { kubeletVersion?: string } } | undefined;
  const spec = lease?.['spec'] as { holderIdentity?: string; renewTime?: string } | undefined;
  const age = now.getTime() - Date.parse(spec?.renewTime ?? '');
  return { name, uid: node.metadata.uid, ready: status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ?? false,
    leaseFresh: spec?.holderIdentity === name && Number.isFinite(age) && age >= -5_000 && age <= NODE_LEASE_FRESH_MS
      && !!lease?.metadata.ownerReferences?.some((ref) => ref.kind === 'Node' && ref.uid === node.metadata.uid), kubeletVersion: status?.nodeInfo?.kubeletVersion ?? '' };
}
/** Reads live API state with a deadline; no cached absence is converted to a proof. */
export async function observeWorkloadStop(k8s: K8sClient, consumer: WorkloadConsumer, now: Date): Promise<WorkloadStopObservation> {
  const signal = AbortSignal.timeout(15_000), pod = await k8s.get<K8sObject>(Resources.Pod!, consumer.podName, consumer.namespace, signal);
  const nodeName = (pod?.['spec'] as { nodeName?: string } | undefined)?.nodeName;
  const node = nodeName ? await nodeEvidence(k8s, nodeName, now, signal) : undefined;
  return classifyWorkloadStop(consumer, pod, node, now);
}
/** Only after the proof store ACK: remove our own finalizer with live UID/resourceVersion CAS. */
export async function releaseWorkloadStop(k8s: K8sClient, proof: WorkloadStopProof): Promise<void> {
  const { namespace, podName } = proof.consumer;
  const current = await k8s.get(Resources.Pod!, podName, namespace, AbortSignal.timeout(15_000));
  if (!current) return;
  if (current.metadata.uid !== proof.podUid || current.metadata.annotations?.[WORKLOAD_CONSUMER_ANNOTATION] !== proof.consumer.id) throw conflict('停止证明对应的 Pod 已被替换');
  const nodeName = (current['spec'] as { nodeName?: string } | undefined)?.nodeName ?? null;
  if (nodeName !== proof.nodeName) throw conflict('停止证明后的 Pod 节点身份变化');
  if (!current.metadata.deletionTimestamp || !current.metadata.finalizers?.includes(WORKLOAD_STOP_FINALIZER)) return;
  await k8s.jsonPatch(Resources.Pod!, podName, namespace, [
    { op: 'test', path: '/metadata/uid', value: proof.podUid }, { op: 'test', path: '/metadata/resourceVersion', value: current.metadata.resourceVersion },
    { op: 'replace', path: '/metadata/finalizers', value: current.metadata.finalizers.filter((entry) => entry !== WORKLOAD_STOP_FINALIZER) },
  ]);
}
