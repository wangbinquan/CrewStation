import type { AgentActivityItem, AgentActivityQuery, ReadAgentActivityRequest, TaskId, UserId } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { and, asc, desc, eq, gt, inArray, lt, lte, max, sql } from 'drizzle-orm';
import { activityNotifies, initialNativeActivity, projectNativeActivity, projectNativeLifecycle } from '../../domain/nativeActivityProjection';
import type { NativeActivityRepository, NativeActivityRead, StoredNativeEvent } from '../../ports/nativeActivity';
import { activityItems as items, activityProgress as progress, activityReads as reads, activityStates as states, activitySources as sources } from './nativeActivityTables';
import { nativeTerminalStarts as starts } from './nativeTerminalTable';
import { nativeActivityIdentity } from './legacyNativeActivityIdentity';

const RETAINED_ITEMS = 2000;
const MAX_PENDING = 256 * 128;
const RESULTS = ['turn-completed', 'turn-failed', 'turn-cancelled', 'turn-unconfirmed'];
const scope = (taskId: TaskId) => eq(progress.taskId, taskId);
/**
 * 写事务按任务串行，但等待有界：持锁事务异常（2026-09-16 实机：一条事务持锁后空闲 8 分钟）时，其余请求在上限后以 precondition 失败并释放连接，
 * 而不是让整个连接池排在这把锁后面把 API 拖死。用 try 锁轮询而不是 lock_timeout：事务里不产生服务端错误，不留下 aborted 事务。
 * 读取不取锁，只用可重复读快照。
 */
const LOCK_WAIT_MS = 1500, LOCK_POLL_MS = 100;
const BUSY = Symbol('native-activity-busy');
async function lock(db: Executor, taskId: TaskId): Promise<boolean> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const rows = await db.execute(sql`select pg_try_advisory_xact_lock(hashtext('dev_session.native_activity'), hashtext(${taskId})) as locked`);
    if ((rows as unknown as Array<{ locked: boolean }>)[0]?.locked === true) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(LOCK_POLL_MS);
  }
}
/** 事务内拿不到锁时正常提交（什么都没写）并在事务外报错，避免依赖驱动对事务内异常的回滚路径。 */
function busyOr<T>(value: T | typeof BUSY): T {
  if (value === BUSY) throw precondition('该任务的动态正在由其他请求写入，请稍后重试');
  return value;
}
const cursor = async (db: Executor, taskId: TaskId) => (await db.select().from(progress).where(scope(taskId)))[0]?.throughSeq ?? 0;
const sourceKey = (taskId: TaskId, sourceTaskId: TaskId) => and(eq(sources.taskId, taskId), eq(sources.sourceTaskId, sourceTaskId));
const sourceCursor = async (db: Executor, taskId: TaskId, sourceTaskId: TaskId) => (await db.select().from(sources).where(sourceKey(taskId, sourceTaskId)))[0]?.throughSeq ?? 0;

export function drizzleNativeActivity(db: Database): NativeActivityRepository {
  return {
    cursor: (taskId, sourceTaskId = taskId) => sourceCursor(db, taskId, sourceTaskId),
    completedSources: async (taskId) => (await db.select({ id: sources.sourceTaskId }).from(sources).where(and(eq(sources.taskId, taskId), eq(sources.complete, true)))).map((r) => r.id as TaskId),
    async completeSource(taskId, sourceTaskId) { await db.insert(sources).values({ taskId, sourceTaskId, complete: true }).onConflictDoUpdate({ target: [sources.taskId, sources.sourceTaskId], set: { complete: true } }); },
    apply: async (taskId, sinceSeq, events, sourceTaskId = taskId) => busyOr(await db.transaction(async (tx) => {
      if (!(await lock(tx, taskId))) return BUSY;
      const throughSeq = await sourceCursor(tx, taskId, sourceTaskId);
      if (sinceSeq > throughSeq) throw precondition('状态投影不能越过未读取的源区间');
      if (events.length > 500 || events.some((event, i) => !Number.isSafeInteger(event.seq) || event.seq <= sinceSeq || (i > 0 && event.seq <= events[i - 1]!.seq))) throw validation('状态来源批次必须有界且按序号递增');
      const batch = events.filter((event) => event.seq > throughSeq);
      if (!batch.length) return throughSeq;
      let projectionSeq = await cursor(tx, taskId);
      const projected = batch.map((entry) => ({ ...entry, seq: projectionSeq = Math.max(projectionSeq + 1, entry.seq) }));
      await applyEvents(tx, taskId, projected, sourceTaskId);
      const next = batch.at(-1)!.seq;
      await tx.insert(sources).values({ taskId, sourceTaskId, throughSeq: next }).onConflictDoUpdate({ target: [sources.taskId, sources.sourceTaskId], set: { throughSeq: next } });
      await tx.insert(progress).values({ taskId, throughSeq: projectionSeq }).onConflictDoUpdate({ target: progress.taskId, set: { throughSeq: projectionSeq } });
      await trim(tx, taskId);
      return next;
    })),
    read: (taskId, userId, query) => db.transaction(async (tx) => readPage(tx, taskId, userId, query), { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    markRead: async (taskId, userId, input) => busyOr(await db.transaction(async (tx) => (await lock(tx, taskId)) ? markRead(tx, taskId, userId, input) : BUSY)),
  };
}

async function applyEvents(db: Executor, taskId: TaskId, events: StoredNativeEvent[], sourceTaskId: TaskId): Promise<void> {
  const known = new Map((await db.select({ agentId: starts.agentId, record: starts.record, executionTaskId: starts.executionTaskId }).from(starts).where(eq(starts.taskId, taskId)).limit(256)).map((row) => [row.agentId, row]));
  const projections = new Map((await db.select().from(states).where(eq(states.taskId, taskId)).limit(256)).map((row) => [row.agentId, row.projection]));
  const changed = new Set<string>(), additions: Array<typeof items.$inferInsert> = [];
  for (const { event, seq, at } of events) {
    if (event.kind !== 'nativeActivity' && event.kind !== 'nativeTerminal') continue;
    const record = event.kind === 'nativeActivity' ? event.activity : event.terminal;
    const start = known.get(record.agentId);
    if (!start || (start.executionTaskId ?? taskId) !== sourceTaskId || start.record.runnerId !== record.runnerId || start.record.terminalId !== record.terminalId) continue;
    const previous = projections.get(record.agentId) ?? initialNativeActivity(start.record);
    const activity = event.kind === 'nativeActivity' ? { ...event.activity, eventId: await nativeActivityIdentity(db, sourceTaskId, event.activity.eventId) } : undefined;
    const result = activity ? projectNativeActivity(previous, activity, seq) : projectNativeLifecycle(previous, record as typeof start.record, seq, at);
    projections.set(record.agentId, result.projection); changed.add(record.agentId);
    if (result.item) additions.push({ taskId, seq, eventId: result.item.eventId, agentId: record.agentId, turnId: result.item.turnId, kind: result.item.kind, item: result.item });
  }
  for (const agentId of changed) {
    const projection = projections.get(agentId)!;
    await db.insert(states).values({ taskId, agentId, projection }).onConflictDoUpdate({ target: [states.taskId, states.agentId], set: { projection } });
  }
  if (additions.length) await db.insert(items).values(additions).onConflictDoNothing();
}

async function trim(db: Executor, taskId: TaskId): Promise<void> {
  const oldest = (await db.select({ seq: items.seq }).from(items).where(eq(items.taskId, taskId)).orderBy(desc(items.seq)).limit(1).offset(RETAINED_ITEMS - 1))[0];
  if (!oldest) return;
  const removed = await db.delete(items).where(and(eq(items.taskId, taskId), sql`${items.seq} < ${oldest.seq}`)).returning({ seq: items.seq });
  if (removed.length) await db.update(progress).set({ prunedThroughSeq: sql`greatest(${progress.prunedThroughSeq}, ${Math.max(...removed.map((row) => row.seq))})` }).where(scope(taskId));
  await db.delete(reads).where(and(eq(reads.taskId, taskId), sql`NOT EXISTS (SELECT 1 FROM ${items} WHERE ${items.taskId} = ${reads.taskId} AND ${items.agentId} = ${reads.agentId} AND ${items.turnId} = ${reads.turnId})`,
    sql`NOT EXISTS (SELECT 1 FROM ${states}, jsonb_array_elements(${states.projection}->'state'->'pending') AS pending WHERE ${states.taskId} = ${reads.taskId} AND ${states.agentId} = ${reads.agentId} AND pending->>'turnId' = ${reads.turnId})`));
}

async function readPage(db: Executor, taskId: TaskId, userId: UserId, query: AgentActivityQuery): Promise<NativeActivityRead> {
  const throughSeq = await cursor(db, taskId);
  if (query.cursor !== undefined && query.cursor > throughSeq) throw validation('动态游标超过当前已同步位置');
  const projections = (await db.select().from(states).where(eq(states.taskId, taskId)).limit(256)).map((row) => row.projection.state);
  const conditions = [eq(items.taskId, taskId)];
  if (query.cursor !== undefined) conditions.push(gt(items.seq, query.cursor));
  if (query.before !== undefined) conditions.push(lt(items.seq, query.before));
  if (query.unread) {
    const latestResults = db.select({ seq: max(items.seq) }).from(items).where(and(eq(items.taskId, taskId), inArray(items.kind, RESULTS))).groupBy(items.agentId, items.turnId);
    conditions.push(inArray(items.seq, latestResults), sql`${items.seq} > coalesce((SELECT ${reads.throughSeq} FROM ${reads} WHERE ${reads.taskId} = ${items.taskId} AND ${reads.agentId} = ${items.agentId} AND ${reads.turnId} = ${items.turnId} AND ${reads.userId} = ${userId}), 0)`);
  }
  const rows = await db.select().from(items).where(and(...conditions)).orderBy(query.cursor === undefined ? desc(items.seq) : asc(items.seq)).limit(query.limit + 1);
  const pruned = (await db.select().from(progress).where(scope(taskId)))[0]?.prunedThroughSeq ?? 0;
  const readRows = await db.select().from(reads).where(and(eq(reads.taskId, taskId), eq(reads.userId, userId))).limit(RETAINED_ITEMS + MAX_PENDING);
  const cursors = new Map(readRows.map((row) => [`${row.agentId}:${row.turnId}`, row.throughSeq]));
  const pending = new Set(projections.flatMap((state) => state.pending.map((request) => `${state.agentId}:${request.turnId}:${request.id}`)));
  const latest = await db.select({ agentId: items.agentId, turnId: items.turnId, seq: max(items.seq) }).from(items).where(and(eq(items.taskId, taskId), inArray(items.kind, RESULTS))).groupBy(items.agentId, items.turnId).limit(RETAINED_ITEMS);
  const resultSeqs = new Map(latest.map((row) => [`${row.agentId}:${row.turnId}`, Number(row.seq)]));
  const page = rows.slice(0, query.limit).map((row) => ({ ...row.item, unread: isUnread(row.item, cursors, pending, resultSeqs) }));
  if (query.cursor === undefined) page.reverse();
  const more = query.cursor !== undefined && rows.length > query.limit;
  return {
    items: page, states: projections.map((state) => ({ ...state, pending: state.pending.map((request) => ({ ...request, unread: request.seq > (cursors.get(`${state.agentId}:${request.turnId}`) ?? 0) })) })), unread: await unreadCounts(db, taskId, userId), throughSeq,
    nextCursor: more ? page.at(-1)!.seq : throughSeq, hasMore: more,
    ...(query.cursor === undefined && rows.length > query.limit ? { previousCursor: page[0]!.seq } : {}),
    historyTruncated: (query.cursor ?? 0) < pruned,
  };
}

function isUnread(item: AgentActivityItem, cursors: Map<string, number>, pending: Set<string>, latest: Map<string, number>): boolean {
  if (!item.turnId || !activityNotifies(item.kind) || item.seq <= (cursors.get(`${item.agentId}:${item.turnId}`) ?? 0)) return false;
  return item.kind === 'request-opened' ? Boolean(item.request && pending.has(`${item.agentId}:${item.turnId}:${item.request.id}`)) : latest.get(`${item.agentId}:${item.turnId}`) === item.seq;
}

async function unreadCounts(db: Executor, taskId: TaskId, userId: UserId): Promise<NativeActivityRead['unread']> {
  const latest = db.select({ seq: max(items.seq) }).from(items).where(and(eq(items.taskId, taskId), inArray(items.kind, RESULTS))).groupBy(items.agentId, items.turnId);
  const rows = await db.select({ agentId: items.agentId,
    completions: sql<number>`count(*) filter (where ${items.kind} = 'turn-completed')::integer`,
    issues: sql<number>`count(*) filter (where ${items.kind} <> 'turn-completed')::integer`,
  }).from(items).leftJoin(reads, and(eq(reads.taskId, items.taskId), eq(reads.agentId, items.agentId), eq(reads.turnId, items.turnId), eq(reads.userId, userId)))
    .where(and(eq(items.taskId, taskId), inArray(items.seq, latest), sql`${items.seq} > coalesce(${reads.throughSeq}, 0)`)).groupBy(items.agentId).limit(256);
  return rows.map((row) => ({ agentId: row.agentId, completions: Number(row.completions), issues: Number(row.issues) }));
}

async function markRead(db: Executor, taskId: TaskId, userId: UserId, input: ReadAgentActivityRequest): Promise<number> {
  if (input.throughSeq > await cursor(db, taskId)) throw validation('只能标记已经读取到的动态');
  const known = (await db.select({ seq: max(items.seq) }).from(items).where(and(eq(items.taskId, taskId), eq(items.agentId, input.agentId), eq(items.turnId, input.turnId), lte(items.seq, input.throughSeq))))[0]?.seq;
  const state = (await db.select().from(states).where(and(eq(states.taskId, taskId), eq(states.agentId, input.agentId))).limit(1))[0]?.projection.state;
  const pending = state?.pending.filter((request) => request.turnId === input.turnId && request.seq <= input.throughSeq).map((request) => request.seq) ?? [];
  // 活跃问题可能比有界历史更老；仍可查看，不因清理历史而被反复标成未读。
  const readSeq = Math.max(Number(known ?? 0), ...pending);
  if (readSeq === 0) throw validation('该 CLI 轮次没有可标记的动态');
  const row = (await db.insert(reads).values({ taskId, userId, agentId: input.agentId, turnId: input.turnId, throughSeq: readSeq }).onConflictDoUpdate({
    target: [reads.taskId, reads.userId, reads.agentId, reads.turnId], set: { throughSeq: sql`greatest(${reads.throughSeq}, ${readSeq})` },
  }).returning())[0]!;
  return row.throughSeq;
}
