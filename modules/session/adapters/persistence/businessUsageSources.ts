import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { RunnerUsageMeasurementSchema } from '@crewstation/contracts';
import type { RunnerBusinessEvent, RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { BusinessUsageSourceStore } from '../../ports/businessUsageSources';
import { businessExecutions as streams, businessUsageEvents as events, businessUsageSources as sources } from './businessTables';

const key = (taskId: TaskId, executionId: string) => and(eq(sources.taskId, taskId), eq(sources.executionId, executionId));

/** Called inside the raw event transaction, before the Runner's durable watermark can advance. */
export async function appendBusinessUsageSources(tx: Executor, taskId: TaskId, receipt: RunnerBusinessReceipt, added: RunnerBusinessEvent[]): Promise<void> {
  const rows = added.flatMap((event) => event.frame.type === 'agent' && event.frame.event.usageCapture
    ? [{ taskId, executionId: receipt.executionId, sequence: event.sequence, agentId: event.frame.event.agentId,
      occurredAt: event.occurredAt, capture: event.frame.event.usageCapture }] : []);
  if (!rows.length) return;
  await tx.insert(sources).values({ taskId, executionId: receipt.executionId, attempt: receipt.attempt,
    incarnation: receipt.incarnation, payloadDigest: receipt.payloadDigest }).onConflictDoNothing();
  await tx.insert(events).values(rows);
}

export function drizzleBusinessUsageSourceStore(db: Database): BusinessUsageSourceStore {
  return {
    measurement: async (source, recordId, revision) => {
      if (!recordId || !Number.isSafeInteger(revision) || revision < 1) throw validation('原生用量修订无效');
      const rows = await db.execute<{ measurement: unknown }>(sql`SELECT DISTINCT item.measurement
        FROM session.business_usage_events e
        JOIN session.business_usage_sources s ON s.task_id=e.task_id AND s.execution_id=e.execution_id
        JOIN session.business_executions b ON b.task_id=e.task_id AND b.execution_id=e.execution_id
        CROSS JOIN LATERAL jsonb_array_elements(e.capture->'measurements') item(measurement)
        WHERE e.task_id=${source.runtimeTaskId} AND e.execution_id=${source.executionId} AND s.attempt=${source.attempt}
          AND s.incarnation=${source.incarnation} AND s.payload_digest=${source.payloadDigest} AND e.sequence<=b.persisted_through
          AND item.measurement->>'recordId'=${recordId} AND item.measurement->>'revision'=${String(revision)} LIMIT 2`);
      if (rows.length > 1) throw conflict('同一原生修订出现不同数值证据');
      return rows[0] ? RunnerUsageMeasurementSchema.parse(rows[0].measurement) : undefined;
    },
    next: () => db.transaction(async (tx) => {
      // Updating the selected execution's poll time prevents a failing consumer from starving other sources.
      const [source] = await tx.select().from(sources).where(sql`EXISTS (
        SELECT 1 FROM session.business_usage_events e
        JOIN session.business_executions s ON s.task_id=e.task_id AND s.execution_id=e.execution_id
        WHERE e.task_id=${sources.taskId} AND e.execution_id=${sources.executionId}
          AND e.sequence>${sources.acknowledgedThrough} AND e.sequence<=s.persisted_through
      )`).orderBy(asc(sources.polledAt), asc(sources.taskId), asc(sources.executionId)).limit(1).for('update', { skipLocked: true });
      if (!source) return undefined;
      const page = await tx.select({ sequence: events.sequence, agentId: events.agentId, occurredAt: events.occurredAt, capture: events.capture }).from(events)
        .innerJoin(streams, and(eq(streams.taskId, events.taskId), eq(streams.executionId, events.executionId)))
        .where(and(eq(events.taskId, source.taskId), eq(events.executionId, source.executionId), gt(events.sequence, source.acknowledgedThrough), lte(events.sequence, streams.persistedThrough),
          // A lost ACK must replay the identical page even if new events arrived meanwhile.
          source.offeredThrough > source.acknowledgedThrough ? lte(events.sequence, source.offeredThrough) : undefined))
        .orderBy(asc(events.sequence)).limit(5);
      const through = page.at(-1)!.sequence;
      await tx.update(sources).set({ offeredThrough: through, polledAt: sql`clock_timestamp()` }).where(key(source.taskId as TaskId, source.executionId));
      return { runtimeTaskId: source.taskId as TaskId, executionId: source.executionId, attempt: source.attempt,
        incarnation: source.incarnation, payloadDigest: source.payloadDigest, after: source.acknowledgedThrough, through, events: page };
    }),
    acknowledge: (taskId, executionId, through) => db.transaction(async (tx) => {
      if (!Number.isSafeInteger(through) || through < 0) throw validation('数值来源确认水位无效');
      const [source] = await tx.select().from(sources).where(key(taskId, executionId)).for('update');
      if (!source) throw notFound('数值来源', executionId);
      if (through <= source.acknowledgedThrough) return;
      if (through > source.offeredThrough) throw conflict('不能确认尚未读取的数值来源');
      const [boundary] = await tx.select({ sequence: events.sequence }).from(events).where(and(eq(events.taskId, taskId), eq(events.executionId, executionId), eq(events.sequence, through)));
      if (!boundary) throw conflict('数值来源确认水位不是事件边界');
      await tx.update(sources).set({ acknowledgedThrough: through }).where(key(taskId, executionId));
    }),
  };
}
