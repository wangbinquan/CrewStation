import { WorkloadConsumerSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { WorkloadPodRender } from '../domain/workloadRender';
import { workloadRenderOf } from '../domain/workloadRender';
import type { ObservedObject } from '../domain/observation';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import type { ClusterWriter } from '../ports/cluster';

interface AdmissionDeps { ledger: LedgerObservations; cluster: ClusterWriter; retryMs?: number }

/** Register before the first Kubernetes write; a stale create still lands behind the UID-bound gate. */
export async function prepareWorkloadAdmission(deps: AdmissionDeps, pod: WorkloadPodRender, volume: ObservedObject | undefined): Promise<WorkloadPodRender> {
  if (!pod.consumer) return pod;
  const safety = deps.ledger.workloadSafety;
  if (!safety?.register || !deps.cluster.inspectWorkloadStart || !deps.cluster.activateWorkload || !volume?.metadata.uid) throw precondition('工作卷启动保护不可用');
  const consumer = WorkloadConsumerSchema.parse({ ...pod.consumer, resourceId: pod.taskId, namespace: pod.namespace, podName: pod.name, volumeUid: volume.metadata.uid });
  const state = await safety.register(consumer);
  if (state.admissionClosed) throw precondition('工作卷消费者启动许可已关闭', { code: 'workload_admission_closed' });
  return { ...pod, consumerVolumeUid: state.consumer.volumeUid };
}

/** Also runs after binding the Pod, because scheduling may finish after Provisioning becomes false. */
export async function reconcileWorkloadAdmission(deps: AdmissionDeps, record: LedgerRecordView, enqueue: (id: string, afterMs?: number) => void): Promise<void> {
  const render = workloadRenderOf(record.id, record.spec), intent = render?.pod.consumer;
  if (!render || !intent || record.desired !== 'present' || record.conditions.some((c) => ['Failed', 'Paused', 'ReleasePending'].includes(c.type) && c.status === 'true')) return;
  const safety = deps.ledger.workloadSafety;
  if (!safety?.grantStart || !deps.cluster.inspectWorkloadStart || !deps.cluster.activateWorkload) throw precondition('工作卷启动保护不可用');
  const state = await safety.get(intent.id);
  if (!state || state.admissionClosed) return;
  const pod = { ...render.pod, consumerVolumeUid: state.consumer.volumeUid };
  const permit = await deps.cluster.inspectWorkloadStart(pod);
  if (!permit) { enqueue(record.id, deps.retryMs ?? 2_000); return; }
  await safety.grantStart(intent.id, permit);
  await deps.cluster.activateWorkload(pod, permit);
}
