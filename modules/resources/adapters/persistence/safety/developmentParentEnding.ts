import { DevelopmentParentEndingProjectionSchema, WorkloadConsumerIntentSchema } from '@crewstation/contracts';
import type { WorkloadConsumer, WorkloadStartPermit } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { LedgerRecord } from '../../../domain/record';

/** The caller holds the same original Resources parent row lock used by the owner seal through final commit. */
export function assertDevelopmentParentConsumer(record: LedgerRecord | undefined, parent: LedgerRecord, volume: LedgerRecord | undefined,
  consumer: WorkloadConsumer, permit?: Omit<WorkloadStartPermit, 'grantedAt'>): void {
  const parsed = DevelopmentParentEndingProjectionSchema.safeParse(parent.spec['developmentParentEnding']);
  if (!parsed.success || parsed.data.phase !== 'prepared') throw precondition('原开发父任务新执行准入已封存', { code: 'workload_admission_closed' });
  const original = parsed.data;
  const { resourceId: _resource, namespace: _namespace, podName: _name, volumeUid: _volume, ...identity } = consumer;
  const intent = WorkloadConsumerIntentSchema.safeParse(identity);
  if (!record || record.id !== parent.id || record.owner.module !== 'task-runtime' || record.owner.ref !== parent.id || parent.kind !== 'dev-workspace'
    || parent.desired !== 'present' || !parent.projectId || consumer.taskId !== parent.id || consumer.resourceId !== parent.id
    || consumer.purpose !== 'development' || consumer.finalization !== null || consumer.id !== original.endingId
    || !intent.success || jsonHash(intent.data) !== jsonHash(original.consumer) || consumer.podName !== original.podName || consumer.volumeUid !== original.pvcUid)
    throw conflict('原父观察消费者身份不匹配');
  const declared = parent.spec.children.find((child) => child.kind === 'Pod' && child.namespace === consumer.namespace && child.name === original.podName);
  const observed = parent.children.find((child) => child.kind === 'Pod' && child.namespace === consumer.namespace && child.name === original.podName);
  if (!declared || !observed || observed.uid !== original.podUid || observed.node !== original.nodeName || !volume || volume.owner.module !== 'task-runtime'
    || volume.owner.ref !== parent.id + '/work' || volume.parentId !== parent.id || volume.projectId !== parent.projectId || volume.desired !== 'present'
    || !volume.children.some((child) => child.kind === 'PersistentVolumeClaim' && child.namespace === consumer.namespace && child.uid === original.pvcUid && child.phase === 'Bound'))
    throw precondition('原父观察材料尚未持久确认或已变化', { code: 'development_parent_materials_pending' });
  if (permit && (permit.podUid !== original.podUid || permit.nodeName !== original.nodeName || permit.nodeUid !== original.nodeUid))
    throw conflict('原父观察 ACK 的 Pod 或节点实例不匹配');
}
