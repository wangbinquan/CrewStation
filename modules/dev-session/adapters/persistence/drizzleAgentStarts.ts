import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { AgentPermission, TaskId, UserId } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { newResourceId } from '@crewstation/kernel';
import type { AgentStart, AgentStartRepository } from '../../ports/agentStarts';
import { agentStarts as table, clusterAgentRestarts } from './agentStartTable';

type Row = typeof table.$inferSelect;

const toStart = (row: Row): AgentStart => ({
  agentId: row.agentId, taskId: row.taskId as TaskId, createdBy: row.createdBy as UserId, compute: row.compute, ...(row.computeName ? { computeName: row.computeName } : {}), profile: row.profile, permission: row.permission as AgentPermission,
  request: row.request, execution: row.execution, state: row.state as AgentStart['state'], ...(row.failure ? { failure: row.failure } : {}), ...(row.cancelled ? { cancelled: true } : {}),
  cursor: row.cursor, finalized: row.finalized, createdAt: row.createdAt, ...(row.dispatchedAt ? { dispatchedAt: row.dispatchedAt } : {}), ...(row.endedAt ? { endedAt: row.endedAt } : {}),
});

const toRow = (start: AgentStart): typeof table.$inferInsert => ({
  agentId: start.agentId, taskId: start.taskId, createdBy: start.createdBy, compute: start.compute, computeName: start.computeName ?? null, profile: start.profile, permission: start.permission, request: start.request,
  execution: start.execution, executionTaskId: start.execution.taskId, state: start.state, failure: start.failure ?? null, cancelled: start.cancelled ?? false, cursor: start.cursor,
  finalized: start.finalized, createdAt: start.createdAt, dispatchedAt: start.dispatchedAt ?? null, endedAt: start.endedAt ?? null,
});

export function drizzleAgentStarts(db: Database): AgentStartRepository {
  return {
    reserveRestart: async (operationId) => {
      const [row] = await db.insert(clusterAgentRestarts).values({ operationId, agentId: newResourceId(), taskId: newResourceId() })
        .onConflictDoUpdate({ target: clusterAgentRestarts.operationId, set: { operationId } }).returning();
      return { agentId: row!.agentId, taskId: row!.taskId as TaskId };
    },
    insert: async (start) => { await db.insert(table).values(toRow(start)); },
    get: async (agentId) => { const row = (await db.select().from(table).where(eq(table.agentId, agentId)))[0]; return row ? toStart(row) : undefined; },
    findByExecution: async (id) => { const row = (await db.select().from(table).where(eq(table.executionTaskId, id)))[0]; return row ? toStart(row) : undefined; },
    listByTask: async (taskId) => (await db.select().from(table).where(eq(table.taskId, taskId)).orderBy(asc(table.createdAt))).map(toStart),
    listUnfinalized: async (after, limit) => (await db.select().from(table).where(and(eq(table.finalized, false), after ? gt(table.agentId, after) : undefined)).orderBy(asc(table.agentId)).limit(limit)).map(toStart),
    update: async (start) => { await db.update(table).set(toRow(start)).where(eq(table.agentId, start.agentId)); },
    withLock: (agentId, operation) => db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dev_session.agent_start'), hashtext(${agentId}))`); await operation(); }),
  };
}
