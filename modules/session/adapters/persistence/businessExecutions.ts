import type { SessionOriginalTaskStorage } from '../../ports/projectDeletion';
import { sessionStorageKey, sessionStoredTaskId } from './deletion/taskStorage';
import { appendBusinessUsageSources } from './businessUsageSources';
import { ordinarySessionTask } from './deletion/admission';
import { assertBusinessStreamOpen, lockBusinessStream } from './stoppedExecutions';
import { businessRetention } from './businessRetention';
import { readCompletionProof } from './completionProofs';
import { and, asc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import type { RunnerBusinessEvent, RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';
import { BusinessExecutionEventSchema, BusinessExecutionReceiptSchema, businessFrameOutputBytes } from '@crewstation/contracts';
import { conflict, gone, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { BusinessExecutionStore, StoredBusinessExecution } from '../../ports/businessExecutions';
import { businessExecutionEvents as events, businessExecutions as streams } from './businessTables';

type Row = typeof streams.$inferSelect;
const key = (taskId: string, executionId: string, storage?: SessionOriginalTaskStorage) => and(eq(streams.taskId, sessionStorageKey(taskId, storage)), eq(streams.executionId, executionId));
const eventKey = (taskId: string, executionId: string, storage?: SessionOriginalTaskStorage) => and(eq(events.taskId, sessionStorageKey(taskId, storage)), eq(events.executionId, executionId));
const snapshot = (row: Row, storage?: SessionOriginalTaskStorage): StoredBusinessExecution => { if (row.expired) throw gone('可靠执行原始日志已过保留期', { code: 'execution_events_expired' }); return ({ taskId: sessionStoredTaskId(row.taskId, storage), receipt: row.receipt, persistedThrough: row.persistedThrough, acknowledgedThrough: row.acknowledgedThrough, complete: row.complete }); };

function sameExecution(prior: RunnerBusinessReceipt, next: RunnerBusinessReceipt): void {
  if (prior.executionId !== next.executionId || prior.attempt !== next.attempt || prior.payloadDigest !== next.payloadDigest || prior.incarnation !== next.incarnation) throw conflict('可靠执行事件的来源或参数已变化');
  if (prior.phase === 'finished' && next.phase === 'finished' && (prior.lastSequence !== next.lastSequence || jsonHash(prior.result) !== jsonHash(next.result))) throw conflict('可靠执行出现不同终态');
  if (next.phase === 'finished' && next.lastSequence < prior.lastSequence) throw conflict('最终水位小于已经观测到的事件');
}
function checkedReceipt(raw: RunnerBusinessReceipt): RunnerBusinessReceipt {
  const receipt = BusinessExecutionReceiptSchema.parse(raw);
  if (receipt.acknowledgedSequence > receipt.lastSequence || (receipt.phase === 'finished') !== (receipt.result !== null) || (receipt.phase === 'finished' && receipt.lastSequence === 0)) throw validation('执行回执状态、水位与结果不一致');
  return receipt;
}
function page(input: RunnerBusinessEvent[], receipt: RunnerBusinessReceipt): RunnerBusinessEvent[] {
  if (input.length > 1000 || Buffer.byteLength(JSON.stringify(input)) > 1024 * 1024) throw validation('可靠事件页超过容量');
  return input.map((raw) => {
    const event = BusinessExecutionEventSchema.parse(raw);
    if (event.sequence < 1 || event.sequence > receipt.lastSequence || Buffer.byteLength(JSON.stringify(event.frame)) > 256 * 1024) throw validation('事件序号或大小超出回执范围');
    if (event.frame.type === 'result' && (receipt.phase !== 'finished' || event.sequence !== receipt.lastSequence || jsonHash(event.frame.result) !== jsonHash(receipt.result))) throw conflict('最终事件与执行回执不匹配');
    return event;
  });
}
async function locked(tx: Executor, taskId: TaskId, executionId: string): Promise<Row> {
  const row = (await tx.select().from(streams).where(key(taskId, executionId)).for('update'))[0];
  if (!row) throw notFound('可靠执行', executionId);
  return row;
}

async function originalBusinessExecutionPage(db: Database, taskKey: string, after: string | null) {
      const rows = await db.select({ executionId: streams.executionId, receipt: streams.receipt }).from(streams)
        .where(and(eq(streams.taskId, taskKey), after === null ? undefined : gt(streams.executionId, after))).orderBy(asc(streams.executionId)).limit(100);
      return rows.map((row) => {
        const receipt = checkedReceipt(row.receipt);
        if (receipt.executionId !== row.executionId) throw precondition('原业务执行行与回执身份冲突');
        return receipt;
      });
}

/** 每条执行一个短行锁；重复和乱序先落库，只有连续水位才允许 ACK Runner。 */
export function drizzleBusinessExecutionStore(db: Database, storage?: SessionOriginalTaskStorage): BusinessExecutionStore {
  return {
    originals: (taskId, after) => originalBusinessExecutionPage(db, sessionStorageKey(taskId, storage), after),
    completionProof: (taskId, executionId) => readCompletionProof(db, sessionStorageKey(taskId, storage), executionId, storage?.taskId),
    ...businessRetention(db, storage),
    register: (taskId, raw) => db.transaction(async (tx) => {
      if (storage) throw precondition('私有原数字适配器不能新增执行');
      const receipt = checkedReceipt(raw);
      await lockBusinessStream(tx, taskId, receipt.executionId);
      await assertBusinessStreamOpen(tx, taskId, receipt.executionId);
      await tx.insert(streams).values({ taskId, executionId: receipt.executionId, receipt }).onConflictDoNothing();
      const row = await locked(tx, taskId, receipt.executionId);
      sameExecution(row.receipt, receipt);
      return snapshot(row);
    }),
    ingest: async (taskId, raw, input) => {
      if (storage) throw precondition('私有原数字适配器不能新增事件');
      const receipt = checkedReceipt(raw), batch = page(input, receipt);
      return db.transaction(async (tx) => {
        await lockBusinessStream(tx, taskId, receipt.executionId);
        await assertBusinessStreamOpen(tx, taskId, receipt.executionId);
        const current = await locked(tx, taskId, receipt.executionId);
        sameExecution(current.receipt, receipt);
        if (current.receipt.phase === 'finished' && batch.some((event) => event.sequence > current.receipt.lastSequence)) throw conflict('不能在最终水位之后追加事件');
        const added = await appendBatch(tx, taskId, receipt.executionId, batch);
        await appendBusinessUsageSources(tx, taskId, receipt, added.map((item) => item.event));
        const outputBytes = current.outputBytes + added.reduce((sum, item) => sum + businessFrameOutputBytes(item.event.frame), 0);
        if (outputBytes > 64 * 1024 * 1024) throw validation('执行输出超过平台容量');
        const candidate = receipt.lastSequence >= current.receipt.lastSequence && current.receipt.phase !== 'finished' ? receipt : current.receipt;
        // A delayed running reply cannot prove that an execution marked unknown is still alive.
        const latest = current.receipt.phase === 'unknown' && candidate.phase !== 'finished' ? { ...candidate, phase: 'unknown' as const } : candidate;
        const persistedThrough = await contiguousThrough(tx, taskId, receipt.executionId, current.persistedThrough);
        const final = latest.phase === 'finished' && persistedThrough === latest.lastSequence && latest.result !== null
          ? (await tx.select({ event: events.event }).from(events).where(and(eventKey(taskId, receipt.executionId), eq(events.sequence, persistedThrough))))[0]?.event : undefined;
        const complete = current.complete || final?.frame.type === 'result';
        if (complete && outputBytes !== latest.outputBytes) throw conflict('输出字节数与完成回执不一致');
        const [row] = await tx.update(streams).set({ receipt: latest, persistedThrough, outputBytes, complete }).where(key(taskId, receipt.executionId)).returning();
        return snapshot(row!);
      });
    },
    get: async (taskId, id) => { const [row] = await db.select().from(streams).where(key(taskId, id, storage)); return row ? snapshot(row, storage) : undefined; },
    list: async (taskId, id, after, limit) => {
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw validation('可靠事件游标或分页大小无效');
      const [stream] = await db.select().from(streams).where(key(taskId, id, storage));
      if (!stream) throw notFound('可靠执行', id);
      if (stream.expired) throw gone('可靠执行原始日志已过保留期', { code: 'execution_events_expired' });
      if (after > stream.persistedThrough) throw validation('游标超出连续持久化水位');
      // 在数据库内按字节裁剪，避免把 1000 个大事件先载入进程内存。
      const rows = await db.execute<{ event: RunnerBusinessEvent }>(sql`SELECT event FROM (
        SELECT event, sequence, sum(octet_length(event::text) + 1) OVER (ORDER BY sequence) AS bytes FROM (
          SELECT event, sequence FROM session.business_execution_events
          WHERE task_id=${sessionStorageKey(taskId, storage)} AND execution_id=${id} AND sequence>${after} AND sequence<=${stream.persistedThrough}
          ORDER BY sequence LIMIT ${limit}
        ) page
      ) bounded WHERE bytes<=1048574 ORDER BY sequence`);
      return rows.map((row) => row.event);
    },
    acknowledge: (taskId, id, through) => db.transaction(async (tx) => {
      if (storage) throw precondition('私有原数字适配器不能确认 Runner 水位');
      const row = await locked(tx, taskId, id);
      if (!Number.isSafeInteger(through) || through < 0 || through > row.persistedThrough) throw conflict('不能确认尚未连续持久化的事件');
      if (through > row.acknowledgedThrough) await tx.update(streams).set({ acknowledgedThrough: through }).where(key(taskId, id));
    }),
    pending: async (taskIds, limit) => {
      if (storage) throw precondition('私有原数字适配器不能参与普通轮询');
      if (!taskIds.length) return [];
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validation('可靠执行轮询批次无效');
      return db.transaction(async (tx) => {
        const rows = await tx.select().from(streams).where(and(ordinarySessionTask(sql`${streams.taskId}`), eq(streams.expired, false), sql`NOT EXISTS (SELECT 1 FROM session.business_stopped_executions stopped WHERE stopped.task_id=${streams.taskId} AND stopped.execution_id=${streams.executionId})`, inArray(streams.taskId, taskIds), or(eq(streams.complete, false), lt(streams.acknowledgedThrough, streams.persistedThrough))))
          .orderBy(asc(streams.polledAt)).limit(limit).for('update', { skipLocked: true });
        for (const row of rows) await tx.update(streams).set({ polledAt: sql`clock_timestamp()` }).where(key(row.taskId as TaskId, row.executionId));
        return rows.map((row) => snapshot(row));
      });
    },
  };
}

async function appendBatch(tx: Executor, taskId: TaskId, executionId: string, batch: RunnerBusinessEvent[]) {
  if (!batch.length) return [];
  const unique = new Map<number, RunnerBusinessEvent>();
  for (const event of batch) {
    if (unique.has(event.sequence) && jsonHash(unique.get(event.sequence)) !== jsonHash(event)) throw conflict('同一事件序号的内容不同');
    unique.set(event.sequence, event);
  }
  const added = await tx.insert(events).values([...unique.values()].map((event) => ({ taskId, executionId, sequence: event.sequence, event, digest: jsonHash(event) }))).onConflictDoNothing().returning({ event: events.event });
  const stored = await tx.select({ sequence: events.sequence, digest: events.digest }).from(events).where(and(eventKey(taskId, executionId), inArray(events.sequence, [...unique.keys()])));
  for (const row of stored) if (row.digest !== jsonHash(unique.get(row.sequence))) throw conflict('重复事件与已持久化内容不同');
  return added;
}

async function contiguousThrough(tx: Executor, taskId: TaskId, executionId: string, after: number): Promise<number> {
  const rows = await tx.select({ sequence: events.sequence }).from(events).where(and(eventKey(taskId, executionId), gt(events.sequence, after))).orderBy(asc(events.sequence)).limit(1000);
  let through = after;
  for (const row of rows) { if (row.sequence !== through + 1) break; through = row.sequence; }
  return through;
}
