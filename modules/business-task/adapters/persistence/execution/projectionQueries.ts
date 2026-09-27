import { executionLogs } from './projectionTables';
import { and, eq, sql } from 'drizzle-orm';
import type { BusinessEvent, BusinessEventPage, BusinessEventQuery, TaskId } from '@crewstation/contracts';
import type { Database, Executor } from '@crewstation/persistence';
import { gone, validation } from '@crewstation/kernel';
import { executionCursor, readExecutionCursor } from '../../../domain/executionCursor';

export async function readProjectedEvents(db: Database, serviceId: string, taskId: TaskId, query: BusinessEventQuery): Promise<BusinessEventPage> {
  return db.transaction((tx) => readEventsSnapshot(tx, serviceId, taskId, query), { isolationLevel: 'repeatable read' });
}
async function readEventsSnapshot(db: Executor, serviceId: string, taskId: TaskId, query: BusinessEventQuery): Promise<BusinessEventPage> {
  const cursorValue = readExecutionCursor(query.after, taskId, query.subtaskId);
  const log = (await db.select().from(executionLogs).where(and(eq(executionLogs.serviceId, serviceId), eq(executionLogs.taskId, taskId))))[0];
  const generation = log?.generation ?? 1, after = cursorValue.sequence;
  if (cursorValue.generation !== generation || (log?.expired && after < log.highWatermark)) throw gone('事件历史已过期，请读取任务快照', { code: 'cursor_expired', earliestCursor: executionCursor(taskId, log?.highWatermark ?? 0, query.subtaskId, generation), snapshotUrl: `/v3/business-tasks/${taskId}` });
  if (after > (log?.highWatermark ?? 0)) throw validation('事件游标超出持久化水位', { code: 'invalid_cursor' });
  if (log?.expired) return { items: [], nextCursor: query.after ?? null, hasMore: false };
  const filter = query.subtaskId ? sql`AND subtask_id=${query.subtaskId}` : sql``;
  const rows = await db.execute<{ event: BusinessEvent; sequence: number }>(sql`SELECT event,sequence FROM (
    SELECT event,sequence,sum(octet_length(event::text)+1) OVER (ORDER BY sequence) AS bytes FROM (
      SELECT event,sequence FROM business_task.execution_events WHERE service_id=${serviceId} AND task_id=${taskId} AND sequence>${after} ${filter}
      ORDER BY sequence LIMIT ${query.limit + 1}
    ) page
  ) bounded WHERE bytes<=1048574 ORDER BY sequence`);
  const selected = rows.slice(0, query.limit), last = selected.at(-1)?.sequence ?? after;
  const remaining = await db.execute<{ present: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM business_task.execution_events WHERE service_id=${serviceId} AND task_id=${taskId} AND sequence>${last} ${filter}) AS present`);
  const items = selected.map(({ event, sequence }) => {
    const cursor = executionCursor(taskId, sequence, query.subtaskId, generation);
    return event.type === 'result' ? { ...event, cursor, data: { ...event.data, finalCursor: cursor } } : { ...event, cursor };
  });
  return { items, nextCursor: selected.length ? executionCursor(taskId, last, query.subtaskId, generation) : query.after ?? null, hasMore: remaining[0]!.present };
}
