import type { SessionOriginalTaskStorage } from '../../ports/projectDeletion';
import { sessionStorageKey } from './deletion/taskStorage';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { DEVELOPMENT_USAGE_LIMITS, DevelopmentUsageKeySchema, DevelopmentUsagePageSchema, RunnerUsageMeasurementSchema, type DevelopmentUsageKey } from '@crewstation/contracts';
import { conflict, precondition, validation } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { DevelopmentUsageSourceStore } from '../../ports/developmentUsage';
import { locked } from './developmentUsageState';
import { ordinarySessionTask } from './deletion/admission';
import { developmentUsageEvents as events, developmentUsageStreams as streams } from './developmentUsageTables';

/** Independent fair PG outbox; it keeps original journal keys and has no ordinary text frames. */
export function drizzleDevelopmentUsageSourceStore(db: Database, storage?: SessionOriginalTaskStorage): DevelopmentUsageSourceStore {
  const offer = (key?: DevelopmentUsageKey) => db.transaction(async (tx) => {
      const row = key ? await locked(tx, key.executionId, key, storage) : (await tx.select().from(streams)
        .where(and(ordinarySessionTask(sql`${streams.taskId}`), gt(streams.persistedThrough, streams.sourceAcknowledgedThrough)))
        .orderBy(asc(streams.sourcePolledAt), asc(streams.taskId)).limit(1).for('update', { skipLocked: true }))[0];
      if (!row || row.persistedThrough <= row.sourceAcknowledgedThrough) return undefined;
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
    });
  return {
    next: () => { if (storage) throw precondition('私有原数字适配器不能参加开发来源普通轮询'); return offer(); },
    offer: (key) => offer(DevelopmentUsageKeySchema.parse(key)),
    acknowledge: (rawKey, through) => db.transaction(async (tx) => {
      const key = DevelopmentUsageKeySchema.parse(rawKey), row = await locked(tx, key.executionId, key, storage);
      if (!Number.isSafeInteger(through) || through < 0) throw validation('开发数字消费水位无效');
      if (through <= row.sourceAcknowledgedThrough) return;
      if (through !== row.offeredThrough) throw conflict('只能确认已提供的完整数字页');
      await tx.update(streams).set({ sourceAcknowledgedThrough: through }).where(eq(streams.taskId, row.taskId));
    }),
    measurement: async (rawKey, recordId, revision) => {
      const key = DevelopmentUsageKeySchema.parse(rawKey);
      if (!recordId || !Number.isSafeInteger(revision) || revision < 1) throw validation('开发原生用量修订无效');
      const rows = await db.execute<{ measurement: unknown }>(sql`SELECT DISTINCT item.measurement
        FROM session.development_usage_events e JOIN session.development_usage_streams s ON s.task_id=e.task_id
        CROSS JOIN LATERAL jsonb_array_elements(e.event->'capture'->'measurements') item(measurement)
        WHERE e.task_id=${sessionStorageKey(key.executionId, storage)} AND s.registration->'key'->>'journalId'=${key.journalId}
          AND s.registration->'key'->>'incarnation'=${key.incarnation} AND s.registration->'key'->>'payloadDigest'=${key.payloadDigest}
          AND e.sequence<=s.persisted_through AND item.measurement->>'recordId'=${recordId}
          AND item.measurement->>'revision'=${String(revision)} LIMIT 2`);
      if (rows.length > 1) throw conflict('同一开发原生修订出现不同数字证据');
      return rows[0] ? RunnerUsageMeasurementSchema.parse(rows[0].measurement) : undefined;
    },
  };
}
