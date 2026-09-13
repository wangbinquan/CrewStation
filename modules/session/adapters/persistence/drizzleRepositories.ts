import type { RunnerEvent, TaskId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, asc, eq, gt, inArray, max } from 'drizzle-orm';
import type { ConnectionRegistry, RunnerEventStore, StoredRunnerEvent } from '../../ports/repositories';
import { connections, runnerEvents } from './tables';

export function drizzleRunnerEventStore(db: Executor): RunnerEventStore {
  const toStored = (row: typeof runnerEvents.$inferSelect): StoredRunnerEvent => ({ taskId: row.taskId as TaskId, seq: row.seq, at: row.at, event: (typeof row.event === 'string' ? JSON.parse(row.event) : row.event) as RunnerEvent });
  return {
    append: async (e) => {
      const agentId = e.event.kind === 'agent' ? e.event.event.agentId : e.event.kind === 'nativeActivity' ? e.event.activity.agentId : null;
      await db.insert(runnerEvents).values({ taskId: e.taskId, seq: e.seq, at: e.at, kind: e.event.kind, agentId, event: e.event }).onConflictDoNothing();
    },
    maxSeq: async (taskId) => Number((await db.select({ m: max(runnerEvents.seq) }).from(runnerEvents).where(eq(runnerEvents.taskId, taskId)))[0]?.m ?? 0),
    listSince: async (taskId, sinceSeq, options) => {
      const conditions = [eq(runnerEvents.taskId, taskId), gt(runnerEvents.seq, sinceSeq)];
      if (options.kinds?.length) conditions.push(inArray(runnerEvents.kind, options.kinds));
      if (options.agentId) conditions.push(eq(runnerEvents.agentId, options.agentId));
      return (await db.select().from(runnerEvents).where(and(...conditions)).orderBy(asc(runnerEvents.seq)).limit(options.limit)).map(toStored);
    },
  };
}

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
