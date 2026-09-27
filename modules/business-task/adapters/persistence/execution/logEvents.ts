import { eq, sql } from 'drizzle-orm';
import type { BusinessEvent, BusinessTaskStateV3, TaskId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { conflict, jsonHash } from '@crewstation/kernel';
import { executionCursor } from '../../../domain/executionCursor';
import { businessEvents as events, executionLogs as logs } from './projectionTables';

/** The caller holds the service transaction lock; numbering survives retention and process restarts. */
export async function nextLogSequence(tx: Executor, serviceId: string, taskId: string): Promise<{ sequence: number; generation: number }> {
  await tx.insert(logs).values({ taskId, serviceId }).onConflictDoNothing();
  const row = (await tx.update(logs).set({ highWatermark: sql`${logs.highWatermark}+1` }).where(sql`${logs.taskId}=${taskId} AND NOT ${logs.expired}`).returning())[0];
  if (!row) throw conflict('已关闭并归档的日志不能追加执行事件', { code: 'resource_gone' });
  return { sequence: row.highWatermark, generation: row.generation };
}
export async function appendTaskState(tx: Executor, serviceId: string, taskId: TaskId, state: BusinessTaskStateV3, generation: number, source: string, now: Date): Promise<void> {
  const log = await nextLogSequence(tx, serviceId, taskId);
  const event: BusinessEvent = { taskId, type: 'task-state', sourceEventId: source, occurredAt: now.toISOString(), cursor: executionCursor(taskId, log.sequence, undefined, log.generation), data: { state, generation } };
  await tx.insert(events).values({ serviceId, taskId, sequence: log.sequence, sourceSequence: 0, subtaskId: null, digest: jsonHash(event), event });
  await tx.update(logs).set({ taskState: state, taskGeneration: generation, ...(state === 'closed' ? { closedAt: now } : {}) }).where(eq(logs.taskId, taskId));
}
