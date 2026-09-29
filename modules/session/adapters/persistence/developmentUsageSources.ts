import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { DEVELOPMENT_USAGE_LIMITS, DevelopmentUsageKeySchema, DevelopmentUsagePageSchema, RunnerUsageMeasurementSchema } from '@crewstation/contracts';
import { conflict, validation } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { DevelopmentUsageSourceStore } from '../../ports/developmentUsage';
import { locked } from './developmentUsageState';
import { developmentUsageEvents as events, developmentUsageStreams as streams } from './developmentUsageTables';

/** Independent fair PG outbox; it keeps original journal keys and has no ordinary text frames. */
export function drizzleDevelopmentUsageSourceStore(db: Database): DevelopmentUsageSourceStore {
  return {
    next: () => db.transaction(async (tx) => {
      const [row] = await tx.select().from(streams).where(gt(streams.persistedThrough, streams.sourceAcknowledgedThrough))
        .orderBy(asc(streams.sourcePolledAt), asc(streams.taskId)).limit(1).for('update', { skipLocked: true });
      if (!row) return undefined;
      const rows = await tx.select({ event: events.event }).from(events).where(and(eq(events.taskId, row.taskId), gt(events.sequence, row.sourceAcknowledgedThrough), lte(events.sequence, row.persistedThrough),
        row.offeredThrough > row.sourceAcknowledgedThrough ? lte(events.sequence, row.offeredThrough) : undefined)).orderBy(asc(events.sequence)).limit(DEVELOPMENT_USAGE_LIMITS.capturesPerPage);
      const selected: typeof rows = [];
      for (const item of rows) {
        const value = { key: row.registration.key, after: row.sourceAcknowledgedThrough, through: item.event.sequence, events: [...selected.map((value) => value.event), item.event] };
        if (Buffer.byteLength(JSON.stringify(value)) > DEVELOPMENT_USAGE_LIMITS.pageBytes) break;
        selected.push(item);
      }
      if (!selected.length) throw conflict('已复制的数字页缺少连续证据或超过容量');
      const page = DevelopmentUsagePageSchema.parse({ key: row.registration.key, after: row.sourceAcknowledgedThrough, through: selected.at(-1)!.event.sequence, events: selected.map((item) => item.event) });
      if (row.offeredThrough > row.sourceAcknowledgedThrough && page.through !== row.offeredThrough) throw conflict('未确认数字页的边界已变化');
      await tx.update(streams).set({ offeredThrough: page.through, sourcePolledAt: sql`clock_timestamp()` }).where(eq(streams.taskId, row.taskId));
      return page;
    }),
    acknowledge: (rawKey, through) => db.transaction(async (tx) => {
      const key = DevelopmentUsageKeySchema.parse(rawKey), row = await locked(tx, key.executionId, key);
      if (!Number.isSafeInteger(through) || through < 0) throw validation('开发数字消费水位无效');
      if (through <= row.sourceAcknowledgedThrough) return;
      if (through !== row.offeredThrough) throw conflict('只能确认已提供的完整数字页');
      await tx.update(streams).set({ sourceAcknowledgedThrough: through }).where(eq(streams.taskId, key.executionId));
    }),
    measurement: async (rawKey, recordId, revision) => {
      const key = DevelopmentUsageKeySchema.parse(rawKey);
      if (!recordId || !Number.isSafeInteger(revision) || revision < 1) throw validation('开发原生用量修订无效');
      const rows = await db.execute<{ measurement: unknown }>(sql`SELECT DISTINCT item.measurement
        FROM session.development_usage_events e JOIN session.development_usage_streams s ON s.task_id=e.task_id
        CROSS JOIN LATERAL jsonb_array_elements(e.event->'capture'->'measurements') item(measurement)
        WHERE e.task_id=${key.executionId} AND s.registration->'key'->>'journalId'=${key.journalId}
          AND s.registration->'key'->>'incarnation'=${key.incarnation} AND s.registration->'key'->>'payloadDigest'=${key.payloadDigest}
          AND e.sequence<=s.persisted_through AND item.measurement->>'recordId'=${recordId}
          AND item.measurement->>'revision'=${String(revision)} LIMIT 2`);
      if (rows.length > 1) throw conflict('同一开发原生修订出现不同数字证据');
      return rows[0] ? RunnerUsageMeasurementSchema.parse(rows[0].measurement) : undefined;
    },
  };
}
