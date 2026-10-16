import { and, asc, desc, eq, gt, lt, inArray, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { BotConversation, BotConversationRepository, BotOperation } from '../../../ports/botConversations';
import { conversations as c, executions as e, operations as o } from './tables';

const conversationRow = (data: BotConversation) => ({ taskId: data.taskId, id: data.id, revision: data.revision, data });
const operationRow = (data: BotOperation) => ({ taskId: data.taskId, requestId: data.requestId, state: data.receipt.state, data });

/** The advisory lock serializes across servers; outbox updates commit before any Runner I/O. */
export function drizzleBotConversations(db: Database, admissionGuarded = false): BotConversationRepository {
  return {
    withLock: (taskId, operation) => db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dev_session.bot'), hashtext(${taskId}))`); return operation(); }),
    get: async (taskId) => (await db.select().from(c).where(eq(c.taskId, taskId)))[0]?.data,
    save: async (data) => { await db.update(c).set(conversationRow(data)).where(eq(c.taskId, data.taskId)); },
    accept: async (conversation, operation) => {
      await db.transaction(async (tx) => {
        const row = conversationRow(conversation);
        await tx.insert(c).values(row).onConflictDoUpdate({ target: c.taskId, set: row });
        await tx.insert(o).values(operationRow(operation));
      });
    },
    operation: async (taskId, requestId) => (await db.select().from(o).where(and(eq(o.taskId, taskId), eq(o.requestId, requestId))))[0]?.data,
    pending: async (taskId) => (await db.select().from(o).where(and(eq(o.taskId, taskId), inArray(o.state, ['accepted', 'unknown']), sql`coalesce(${o.data}->>'closed', 'false') <> 'true'`)).orderBy(asc(o.requestId))).map((row) => row.data),
    updateOperation: async (data) => { await db.update(o).set(operationRow(data)).where(and(eq(o.taskId, data.taskId), eq(o.requestId, data.requestId))); },
    execution: async (id) => (await db.select().from(e).where(eq(e.agentId, id)))[0]?.data,
    attachExecution: async (conversation, operation, execution) => {
      await db.transaction(async (tx) => {
        await tx.update(c).set(conversationRow(conversation)).where(eq(c.taskId, conversation.taskId));
        await tx.update(o).set(operationRow(operation)).where(and(eq(o.taskId, operation.taskId), eq(o.requestId, operation.requestId)));
        await tx.insert(e).values({ agentId: execution.agentId, taskId: execution.taskId, executionTaskId: execution.executionTaskId, data: execution });
      });
    },
    putExecution: async (data) => {
      const row = { agentId: data.agentId, taskId: data.taskId, executionTaskId: data.executionTaskId, data };
      await db.insert(e).values(row).onConflictDoUpdate({ target: e.agentId, set: { data } });
    },
    history: async (taskId, after, limit) => (await db.select().from(e).where(and(eq(e.taskId, taskId), after ? lt(e.agentId, after) : undefined)).orderBy(desc(e.agentId)).limit(limit)).map((row) => row.data),
    list: async (after, limit) => (await db.select().from(c).where(and(after ? gt(c.id, after) : undefined,
      admissionGuarded ? sql`NOT EXISTS(SELECT 1 FROM dev_session.content_origins origins INNER JOIN dev_session.project_admissions admissions ON admissions.project_id=origins.project_id WHERE origins.kind='task' AND origins.key=${c.taskId})` : undefined)).orderBy(asc(c.id)).limit(limit)).map((row) => row.data),
  };
}
