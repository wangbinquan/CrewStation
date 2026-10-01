import { DEVELOPMENT_REMOVAL_ANNOTATION } from '@crewstation/contracts';
import type { DevelopmentAdmissionReceipt, DevelopmentAdmissionState, WorkloadStartPermit } from '@crewstation/contracts';
import { DevelopmentAdmissionReceiptSchema, DevelopmentAdmissionStateSchema, DevelopmentRemovalProtectionSchema, DevelopmentUsageStorageSchema, WorkloadConsumerSchema } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, secretObject } from '@crewstation/k8s';
import { conflict, precondition } from '@crewstation/kernel';
import type { WorkloadPodRender } from '../../../domain/workloadRender';
import type { DevelopmentAdmissionReceiptBuffer } from './developmentAdmissionReceipts';

type Permit = Omit<WorkloadStartPermit, 'grantedAt'>;
type Seed = Omit<DevelopmentAdmissionReceipt, 'secretUid'>;
function originalSeed(pod: WorkloadPodRender, permit: Permit, raw: DevelopmentAdmissionState | undefined): Seed {
  const selected = DevelopmentAdmissionStateSchema.safeParse(raw);
  if (!selected.success || !DevelopmentRemovalProtectionSchema.safeParse(pod.developmentRemovalProtection).success
    || !DevelopmentUsageStorageSchema.safeParse(pod.developmentUsageProtection).success || !DevelopmentUsageStorageSchema.safeParse(pod.developmentUsageStorage).success
    || pod.workload !== 'dev-session' || pod.nodeName !== permit.nodeName || pod.workspace?.pvcUid !== pod.consumerVolumeUid || pod.expectedVolumeUid !== pod.consumerVolumeUid
    || selected.data.intentHash !== pod.annotations?.['crewstation.io/cli-intent']) throw precondition('原开发准入回执选择或不可变意图缺失');
  const consumer = WorkloadConsumerSchema.parse({ ...pod.consumer, resourceId: pod.taskId, namespace: pod.namespace, podName: pod.name, volumeUid: pod.consumerVolumeUid });
  if (consumer.purpose !== 'agent' || consumer.finalization !== null || pod.labels?.['crewstation.io/workspace-task'] !== consumer.taskId) throw precondition('原开发准入回执不属于独立开发 Agent');
  return { version: 1, consumer, permit, intentHash: selected.data.intentHash };
}
function receiptOf(object: K8sObject, seed: Seed): DevelopmentAdmissionReceipt {
  const data = object['data'] as Record<string, string> | undefined, plain = object['stringData'] as Record<string, string> | undefined;
  const values = { podUid: seed.permit.podUid, nodeUid: seed.permit.nodeUid, consumerId: seed.consumer.id, volumeUid: seed.consumer.volumeUid };
  if (object.metadata.name !== seed.consumer.podName + '-admission' || object.metadata.namespace !== seed.consumer.namespace
    || object['immutable'] !== true || object.metadata.labels?.[LABELS.task] !== seed.consumer.resourceId
    || Object.keys(plain ?? data ?? {}).length !== 4 || Object.entries(values).some(([key, value]) => (plain?.[key] ?? (data?.[key] ? Buffer.from(data[key]!, 'base64').toString('utf8') : undefined)) !== value)) throw conflict('实际准入 Secret 的原材料或归属不匹配');
  return DevelopmentAdmissionReceiptSchema.parse({ ...seed, secretUid: object.metadata.uid });
}
/** A current same-name object never substitutes for a missing historical create response. */
export async function activateDevelopmentWorkload(k8s: K8sClient, pod: WorkloadPodRender, permit: Permit, state: DevelopmentAdmissionState | undefined, receipts: DevelopmentAdmissionReceiptBuffer | undefined): Promise<void | DevelopmentAdmissionReceipt> {
  const seed = originalSeed(pod, permit, state);
  if (!receipts) throw precondition('原创建回执保留能力未装配');
  const name = pod.name + '-admission';
  if (state!.secretUid !== null) {
    const stored = await k8s.get(Resources.Secret!, name, pod.namespace);
    if (!stored || stored.metadata.deletionTimestamp) throw precondition('原准入 Secret 已缺失，不能重新创建');
    if (receiptOf(stored, seed).secretUid !== state!.secretUid) throw conflict('同名准入 Secret 不是持久的原 UID');
    return;
  }
  return receipts.create(seed, async () => {
    const values = { podUid: permit.podUid, nodeUid: permit.nodeUid, consumerId: seed.consumer.id, volumeUid: seed.consumer.volumeUid };
    const desired = { ...secretObject({ name, namespace: pod.namespace, stringData: values, labels: { [LABELS.task]: pod.taskId } }), immutable: true };
    desired.metadata.annotations = { ...desired.metadata.annotations, [DEVELOPMENT_REMOVAL_ANNOTATION]: '1' };
    return receiptOf(await k8s.create(desired), seed);
  }, async () => !!await k8s.get(Resources.Secret!, name, pod.namespace));
}
