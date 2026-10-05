import type { SessionOriginalTaskStorage } from '../../ports/projectDeletion';
import { originalDevelopmentRow, sessionStorageKey } from './deletion/taskStorage';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { DevelopmentUsageLookupSchema, TaskIdSchema, DevelopmentUsageDrainReasonSchema, DevelopmentUsageKeySchema, DevelopmentUsageLossSchema, DevelopmentUsagePageSchema, DevelopmentUsageReceiptSchema, DevelopmentUsageRegistrationSchema } from '@crewstation/contracts';
import type { DevelopmentUsagePage, TaskId } from '@crewstation/contracts';
import { conflict, jsonHash, precondition, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { DevelopmentUsageStore } from '../../ports/developmentUsage';
import { copyNativeEvidence, hasMissingNativeCopy, nativeCopyControls } from './developmentNativeCopies';
import { assertKey, latestReceipt, locked, snapshot, updateClosure } from './developmentUsageState';
import { developmentUsageEvents as events, developmentUsageStreams as streams } from './developmentUsageTables';

export function drizzleDevelopmentUsageStore(db: Database, storage?: SessionOriginalTaskStorage): DevelopmentUsageStore {
  return {
    lookup: async (rawTaskId) => {
      const taskId = TaskIdSchema.parse(rawTaskId);
      const [row] = await db.select().from(streams).where(eq(streams.taskId, sessionStorageKey(taskId, storage)));
      // Only an actual successful SQL query with no row can produce explicit absence.
      return DevelopmentUsageLookupSchema.parse(row ? { version: 1, runtimeTaskId: taskId, kind: 'registered', stored: snapshot(originalDevelopmentRow(row, storage)) }
        : { version: 1, runtimeTaskId: taskId, kind: 'absent' });
    },
    register: (raw) => db.transaction(async (tx) => {
      if (storage) throw precondition('私有原数字适配器不能新增开发登记');
      const registration = DevelopmentUsageRegistrationSchema.parse(raw);
      await tx.insert(streams).values({ taskId: registration.runtimeTaskId, registration }).onConflictDoNothing();
      const row = await locked(tx, registration.runtimeTaskId, registration.key);
      if (jsonHash(row.registration) !== jsonHash(registration)) throw conflict('同一开发执行不能重新绑定数字来源');
      return snapshot(row);
    }),
    get: async (taskId, rawKey) => {
      const key = DevelopmentUsageKeySchema.parse(rawKey);
      const [original] = await db.select().from(streams).where(eq(streams.taskId, sessionStorageKey(taskId, storage)));
      const row = original && originalDevelopmentRow(original, storage);
      if (!row) return undefined;
      assertKey(row, key); return snapshot(row);
    },
    ingest: (taskId, rawReceipt, rawPage, nativeCopies = []) => db.transaction(async (tx) => {
      if (storage) throw precondition('私有原数字适配器不能新增开发数字');
      const receipt = DevelopmentUsageReceiptSchema.parse(rawReceipt);
      const page = rawPage ? DevelopmentUsagePageSchema.parse(rawPage) : undefined;
      const row = await locked(tx, taskId, receipt.key);
      if (row.loss) throw conflict('已登记不可取回的来源不能继续追加数字');
      const latest = latestReceipt(row, receipt);
      if (page) {
        if (jsonHash(page.key) !== jsonHash(receipt.key) || page.through > receipt.lastSequence) throw conflict('数字页超出原回执范围');
        await appendPage(tx, taskId, page);
      }
      await copyNativeEvidence(tx, taskId, row.registration, nativeCopies);
      const persistedThrough = await contiguousThrough(tx, taskId, row.persistedThrough);
      const complete = row.complete || (latest.finalThrough !== null && latest.finalThrough === persistedThrough && !await hasMissingNativeCopy(tx, taskId, persistedThrough));
      const [updated] = await tx.update(streams).set({ receipt: latest, persistedThrough, complete,
        runnerAcknowledgedThrough: Math.max(row.runnerAcknowledgedThrough, receipt.acknowledgedSequence),
      }).where(eq(streams.taskId, taskId)).returning();
      return snapshot(await updateClosure(tx, updated!));
    }),
    ...nativeCopyControls(db, storage),
    acknowledgeRunner: (taskId, rawKey, through) => db.transaction(async (tx) => {
      if (storage) throw precondition('私有原数字适配器不能确认开发 Runner 水位');
      const row = await locked(tx, taskId, DevelopmentUsageKeySchema.parse(rawKey));
      if (!Number.isSafeInteger(through) || through < 0 || through > row.persistedThrough) throw conflict('不能确认尚未连续复制的开发数字');
      if (through > row.runnerAcknowledgedThrough) await tx.update(streams).set({ runnerAcknowledgedThrough: through }).where(eq(streams.taskId, taskId));
    }),
    requestDrain: (taskId, rawKey, rawReason) => db.transaction(async (tx) => {
      const row = await locked(tx, taskId, DevelopmentUsageKeySchema.parse(rawKey), storage);
      const reason = DevelopmentUsageDrainReasonSchema.parse(rawReason);
      const [updated] = await tx.update(streams).set({ drainReason: row.drainReason ?? reason }).where(eq(streams.taskId, sessionStorageKey(taskId, storage))).returning();
      return snapshot(originalDevelopmentRow(await updateClosure(tx, updated!), storage));
    }),
    unavailable: (taskId, rawLoss) => db.transaction(async (tx) => {
      if (storage) throw precondition('私有原数字适配器不能制造开发来源缺口');
      const loss = DevelopmentUsageLossSchema.parse(rawLoss), row = await locked(tx, taskId, loss.key);
      if (loss.podUid !== row.registration.podUid) throw conflict('不可取回证明不属于原开发 Pod');
      if (row.loss && jsonHash(row.loss) !== jsonHash(loss)) throw conflict('不能替换已持久的开发来源缺口');
      const [updated] = await tx.update(streams).set({ loss }).where(eq(streams.taskId, taskId)).returning();
      return snapshot(await updateClosure(tx, updated!));
    }),
    pending: async (taskIds, limit) => {
      if (storage) throw precondition('私有原数字适配器不能参加开发普通轮询');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validation('开发数字轮询批次无效');
      if (!taskIds.length) return [];
      return db.transaction(async (tx) => {
        const rows = await tx.select().from(streams).where(and(ordinarySessionTask(sql`${streams.taskId}`), inArray(streams.taskId, taskIds), sql`${streams.loss} IS NULL`, or(and(sql`${streams.closure} IS NULL`, eq(streams.complete, false)), lt(streams.runnerAcknowledgedThrough, streams.persistedThrough))))
          .orderBy(asc(streams.polledAt), asc(streams.taskId)).limit(limit).for('update', { skipLocked: true });
        for (const row of rows) await tx.update(streams).set({ polledAt: sql`clock_timestamp()` }).where(eq(streams.taskId, row.taskId));
        return rows.map(snapshot);
      });
    },
  };
}

async function appendPage(tx: Executor, taskId: TaskId, page: DevelopmentUsagePage): Promise<void> {
  if (!page.events.length) return;
  await tx.insert(events).values(page.events.map((event) => ({ taskId, sequence: event.sequence, event, digest: jsonHash(event) }))).onConflictDoNothing();
  const stored = await tx.select({ sequence: events.sequence, digest: events.digest }).from(events).where(and(eq(events.taskId, taskId), inArray(events.sequence, page.events.map((event) => event.sequence))));
  for (const row of stored) if (row.digest !== jsonHash(page.events.find((event) => event.sequence === row.sequence)!)) throw conflict('开发数字同序号内容冲突');
}

/** Constant-size response: all already committed contiguous PG records count, including earlier out-of-order pages. */
async function contiguousThrough(tx: Executor, taskId: TaskId, after: number): Promise<number> {
  const [row] = await tx.execute<{ through: string }>(sql`WITH ordered AS (
    SELECT sequence, ${after}::bigint + row_number() OVER (ORDER BY sequence) AS expected
    FROM session.development_usage_events WHERE task_id=${taskId} AND sequence>${after}
  ) SELECT coalesce((min(expected) FILTER (WHERE sequence<>expected))-1, max(sequence), ${after}) AS through FROM ordered`);
  return Number(row!.through);
}
import { ordinarySessionTask } from './deletion/admission';
