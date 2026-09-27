import { scopeOver } from './drizzleUnitOfWork';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { text, timestamp } from 'drizzle-orm/pg-core';
import { newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { LegacyMutations } from '../../ports/legacyMutations';
import { businessTaskSchema } from './schema';
import { executionTransaction, readExecutionControl } from './executionTransaction';

const tickets = businessTaskSchema.table('legacy_mutations', {
  id: text('id').primaryKey(), serviceId: text('service_id').notNull(), kind: text('kind').notNull(), taskId: text('task_id'),
  parentId: text('parent_id'), ownerPodUid: text('owner_pod_uid'),
  state: text('state').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export async function legacyMutationsQuiescent(db: Executor, serviceId: string): Promise<boolean> {
  return !(await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.serviceId, serviceId), ne(tickets.state, 'complete'))).limit(1)).length;
}

export function drizzleLegacyMutations(db: Database, ownerPodUid?: string): LegacyMutations {
  return {
    local: (ticket, run) => executionTransaction(db, ticket.serviceId, async (tx) => {
      const scope = scopeOver(tx);
      const assertOpen = async () => {
        const row = (await tx.select().from(tickets).where(and(eq(tickets.id, ticket.id), eq(tickets.serviceId, ticket.serviceId))))[0];
        if (row?.state !== 'open') throw precondition('旧准入票据已终止，不能登记新任务');
      };
      // Result/cleanup updates of already accepted work may finish after the request returned. New resources may not.
      return run({ ...scope, tasks: { ...scope.tasks, insert: async (task) => { await assertOpen(); return scope.tasks.insert(task); } },
        subtasks: { ...scope.subtasks, insert: async (task) => { await assertOpen(); return scope.subtasks.insert(task); } } });
    }),
    list: async (serviceId) => (await db.select().from(tickets).where(and(eq(tickets.serviceId, serviceId), ne(tickets.state, 'complete'))).orderBy(asc(tickets.updatedAt)).limit(100)).map((row) => ({ ...row, state: row.state as 'open' | 'unknown', createdAt: row.createdAt.toISOString(), taskId: row.taskId ?? undefined, parentId: row.parentId ?? undefined, ownerPodUid: row.ownerPodUid ?? undefined })),
    childrenComplete: async (id) => !(await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.parentId, id), ne(tickets.state, 'complete'))).limit(1)).length,
    recover: (ticket) => executionTransaction(db, ticket.serviceId, async (tx, now) => {
      // Compare the observed state; normal completion racing recovery is harmless. Never delete the tombstone.
      return (await tx.update(tickets).set({ state: 'complete', updatedAt: now }).where(and(eq(tickets.id, ticket.id), eq(tickets.serviceId, ticket.serviceId), eq(tickets.state, ticket.state))).returning()).length === 1;
    }),
    begin: (input) => executionTransaction(db, input.serviceId, async (tx, now) => {
      if (await readExecutionControl(tx, input.serviceId)) throw precondition('服务已启用执行权控制，请使用携带 fence 的 v3 写接口', { code: 'execution_fence_required' });
      const ticket = { ...input, ...(ownerPodUid ? { ownerPodUid } : {}), id: newResourceId() };
      await tx.insert(tickets).values({ ...ticket, state: 'open', createdAt: now, updatedAt: now });
      return ticket;
    }),
    settle: async (ticket, state) => {
      await db.update(tickets).set({ state, updatedAt: sql`clock_timestamp()` }).where(and(eq(tickets.id, ticket.id), eq(tickets.serviceId, ticket.serviceId), eq(tickets.state, 'open')));
    },
  };
}
