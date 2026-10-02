import { eq, sql } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import type { WorkloadConsumer, WorkloadStartPermit } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import { drizzleRecordRepository } from '../drizzleRecords';
import { consumers, storageFences } from './tables';
import { assertDevelopmentConsumerOwner, needsDevelopmentOwnerCheck } from './development';

/** Serializes admission, closure and finalization across every API/controller replica. */
export async function lockStorageTask(tx: Executor, taskId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`resources.task-storage:${taskId}`}, 0))`);
}
export async function requireConsumer(tx: Executor, id: string) {
  const row = (await tx.select().from(consumers).where(eq(consumers.id, id)))[0];
  if (!row) throw notFound('工作卷消费者', id);
  return row;
}
export async function assertConsumerOwner(tx: Executor, consumer: WorkloadConsumer, permit?: Omit<WorkloadStartPermit, 'grantedAt'>): Promise<void> {
  // Task seals its projection under this same parent row lock; hold admission through commit.
  const records = drizzleRecordRepository(tx), parent = await records.get(consumer.taskId, { forUpdate: true });
  const record = consumer.resourceId === consumer.taskId ? parent : await records.get(consumer.resourceId);
  if (needsDevelopmentOwnerCheck(record, parent, consumer)) {
    const volume = await records.getByOwner({ module: 'task-runtime', ref: consumer.taskId + '/work' }, 'volume');
    assertDevelopmentConsumerOwner(record, parent, volume, consumer, permit); return;
  }
  if (!record || record.owner.module !== 'task-runtime' || record.desired !== 'present' || !parent || parent.owner.module !== 'task-runtime' || parent.kind !== 'business-workspace') throw precondition('执行资源已不可准入', { code: 'workload_admission_closed' });
  if (record.projectId !== parent.projectId || (record.id !== parent.id && record.parentId !== parent.id)) throw conflict('工作卷消费者归属不匹配');
  if (!record.spec.children.some((c) => c.kind === 'Pod' && c.namespace === consumer.namespace && c.name === consumer.podName)) throw conflict('Pod 身份不属于此执行资源');
  const volume = await records.getByOwner({ module: 'task-runtime', ref: `${consumer.taskId}/work` }, 'volume');
  if (!volume || volume.parentId !== parent.id || volume.projectId !== parent.projectId || volume.desired !== 'present' || !volume.spec['taskStorage']
    || !volume.children.some((c) => c.kind === 'PersistentVolumeClaim' && c.namespace === consumer.namespace && c.uid === consumer.volumeUid && c.phase !== 'absent')) throw precondition('消费者原工作卷尚未持久确认或已变化', { code: 'workspace_volume_changed' });
}
export async function assertTaskAllowsConsumer(tx: Executor, consumer: WorkloadConsumer): Promise<void> {
  const row = (await tx.select().from(storageFences).where(eq(storageFences.taskId, consumer.taskId)))[0], fence = row?.finalization;
  if (row?.sealed) throw precondition('任务全部消费者准入已封存', { code: 'workload_admission_closed' });
  if (consumer.purpose === 'archive') {
    if (!fence || fence.operationId !== consumer.finalization!.operationId || fence.revision !== consumer.finalization!.revision) throw precondition('归档启动许可已变化', { code: 'archive_revision_changed' });
  } else if (fence) throw precondition('任务已进入终结，不能启动新的卷写者', { code: 'task_finalizing' });
}
