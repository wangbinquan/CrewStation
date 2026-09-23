import { jsonHash } from '@crewstation/kernel';
import type { RunnerEvent, TaskId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, asc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import type { ConnectionRegistry, RunnerEventStore, RunnerEventSummary, StoredRunnerEvent } from '../../ports/repositories';
import { connections, runnerEvents } from './tables';

export function drizzleRunnerEventStore(db: Executor): RunnerEventStore {
  const toStored = (row: typeof runnerEvents.$inferSelect): StoredRunnerEvent => ({ taskId: row.taskId as TaskId, seq: row.seq, at: row.at, event: (typeof row.event === 'string' ? JSON.parse(row.event) : row.event) as RunnerEvent });
  return {
    append: async (e) => {
      const agentId = e.event.kind === 'agent' ? e.event.event.agentId : e.event.kind === 'nativeActivity' ? e.event.activity.agentId : e.event.kind === 'beforeStart' ? e.event.execution.agentId : null;
      await db.insert(runnerEvents).values({ taskId: e.taskId, seq: e.seq, at: e.at, kind: e.event.kind, agentId, event: e.event, legacyEvent: e.legacyEvent, identityProvenance: e.legacyEvent === undefined ? null : { originalHash: jsonHash(e.legacyEvent), normalizedHash: jsonHash(e.event), protocol: 2 } }).onConflictDoNothing();
    },
    maxSeq: async (taskId) => Number((await db.select({ m: max(runnerEvents.seq) }).from(runnerEvents).where(eq(runnerEvents.taskId, taskId)))[0]?.m ?? 0),
    listSince: async (taskId, sinceSeq, options) => {
      const conditions = [eq(runnerEvents.taskId, taskId), gt(runnerEvents.seq, sinceSeq)];
      if (options.kinds?.length) conditions.push(inArray(runnerEvents.kind, options.kinds));
      if (options.agentId) conditions.push(eq(runnerEvents.agentId, options.agentId));
      return (await db.select().from(runnerEvents).where(and(...conditions)).orderBy(asc(runnerEvents.seq)).limit(options.limit)).map(toStored);
    },
    summarize: async (taskIds, kinds) => {
      const out: RunnerEventSummary[] = [];
      for (let i = 0; i < taskIds.length; i += 500) {
        const rows = await db.select({
          taskId: runnerEvents.taskId,
          events: sql<number>`(count(*) filter (where ${inArray(runnerEvents.kind, [...kinds])}))::int`,
          // 会话 ID 与协议分别来自 Agent 事件、CLI 名册与活动信号；用换行拼接，避免依赖驱动对数组类型的解析。
          sessionIds: sql<string | null>`string_agg(distinct coalesce(${runnerEvents.event}->'event'->>'sessionId', ${runnerEvents.event}->'terminal'->>'nativeSessionId', ${runnerEvents.event}->'activity'->'signal'->>'nativeSessionId'), E'\n')`,
          protocol: sql<string | null>`max(coalesce(${runnerEvents.event}->'event'->'spec'->>'protocol', ${runnerEvents.event}->'terminal'->>'protocol'))`,
        }).from(runnerEvents).where(and(inArray(runnerEvents.taskId, [...taskIds.slice(i, i + 500)]), inArray(runnerEvents.kind, [...new Set([...kinds, ...SUMMARY_SOURCES])])))
          .groupBy(runnerEvents.taskId);
        out.push(...rows.map((r) => ({ taskId: r.taskId as TaskId, events: Number(r.events), sessionIds: r.sessionIds ? r.sessionIds.split('\n').sort() : [], ...(r.protocol ? { protocol: r.protocol } : {}) })));
      }
      return out;
    },
  };
}

/** 带原生会话 ID 或协议的事件种类；其余种类（如平台自己执行的命令）不参与汇总。 */
const SUMMARY_SOURCES: readonly RunnerEvent['kind'][] = ['agent', 'nativeTerminal', 'nativeActivity'];

export function drizzleConnectionRegistry(db: Executor): ConnectionRegistry {
  return {
    claim: async (taskId, replica, at) => {
      await db.insert(connections).values({ taskId, replica, connectedAt: at, lastSeenAt: at }).onConflictDoUpdate({ target: connections.taskId, set: { replica, connectedAt: at, lastSeenAt: at } });
    },
    release: async (taskId, replica) => { await db.delete(connections).where(and(eq(connections.taskId, taskId), eq(connections.replica, replica))); },
    heartbeat: async (taskId, replica, at) => { await db.update(connections).set({ lastSeenAt: at }).where(and(eq(connections.taskId, taskId), eq(connections.replica, replica))); },
    lookup: async (taskId) => {
      const row = (await db.select().from(connections).where(eq(connections.taskId, taskId)))[0];
      return row ? { replica: row.replica, lastSeenAt: row.lastSeenAt } : undefined;
    },
  };
}
