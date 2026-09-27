import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import type { ExecutionMessage } from '../../../domain/executionMessage';
import { liveControl } from '../../../domain/executionControl';
import type { ExecutionMessages } from '../../../ports/executionMessages';
import { executionTransaction, authorizeExecution, readExecutionControl } from '../executionTransaction';
import { assertTaskAcceptsExecution } from '../execution/lifecycleAdmission';
import { executionSubtasks as tasks } from '../execution/subtaskTables';
import { executionMessages as messages } from './tables';

const view = (row: typeof messages.$inferSelect): ExecutionMessage => ({ ...row, state: row.state as ExecutionMessage['state'] });
const leased = (claim: ExecutionMessage) => and(eq(messages.id, claim.id), eq(messages.owner, claim.owner!), eq(messages.revision, claim.revision), eq(messages.state, 'dispatching'), sql`${messages.leaseUntil} > clock_timestamp()`);
const ready = () => or(sql`${messages.state} IN ('pending','awaiting','unknown')`, and(eq(messages.state, 'dispatching'), lt(messages.leaseUntil, sql`clock_timestamp()`)));
export function drizzleExecutionMessages(db: Database): ExecutionMessages {
  return {
    find: async (serviceId, taskId, subtaskId, key) => { const row = (await db.select().from(messages).where(and(eq(messages.serviceId, serviceId), eq(messages.taskId, taskId as ExecutionMessage['taskId']), eq(messages.subtaskId, subtaskId), eq(messages.requestKey, key))))[0]; return row && view(row); },
    get: async (id) => { const row = (await db.select().from(messages).where(eq(messages.id, id)))[0]; return row && view(row); },
    reserve: (candidate, authorization) => executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const previous = (await tx.select().from(messages).where(and(eq(messages.serviceId, candidate.serviceId), eq(messages.subtaskId, candidate.subtaskId), eq(messages.requestKey, candidate.requestKey))))[0];
      if (previous) { if (previous.requestDigest !== candidate.requestDigest) throw conflict('消息幂等键参数不同', { code: 'idempotency_conflict' }); return view(previous); }
      const subtask = (await tx.select().from(tasks).where(and(eq(tasks.id, candidate.subtaskId), eq(tasks.serviceId, candidate.serviceId), eq(tasks.taskId, candidate.taskId))).for('update'))[0];
      if (!subtask || subtask.view.kind !== 'agent' || subtask.view.attempt !== candidate.attempt || subtask.view.executionId !== candidate.executionId || subtask.incarnation !== candidate.incarnation) throw conflict('Agent 执行身份已变化', { code: 'stale_generation' });
      const epoch = await authorizeExecution(tx, candidate.serviceId, subtask.fenced, authorization, now);
      await assertTaskAcceptsExecution(tx, candidate.taskId);
      if (subtask.view.state !== 'awaiting-input' || subtask.view.process !== 'live' || subtask.view.cancelRequestedAt) throw conflict('Agent 当前不接受消息', { code: 'agent_not_waiting' });
      if ((await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.subtaskId, candidate.subtaskId), sql`${messages.state} NOT IN ('succeeded','failed')`)).limit(1)).length) throw conflict('上一条消息尚未确认', { code: 'message_in_flight' });
      return view((await tx.insert(messages).values({ ...candidate, epoch, state: 'pending', updatedAt: now }).returning())[0]!);
    }),
    adopt: (message, authorization) => executionTransaction(db, message.serviceId, async (tx, now) => {
      const row = (await tx.select().from(messages).where(eq(messages.id, message.id)).for('update'))[0]!;
      if (row.dispatched || row.state !== 'pending') return view(row);
      const epoch = await authorizeExecution(tx, row.serviceId, row.epoch !== null, authorization, now);
      return view((await tx.update(messages).set({ epoch, updatedAt: now }).where(eq(messages.id, row.id)).returning())[0]!);
    }),
    claim: (owner, id) => claimMessage(db, owner, id),
    checkpoint: (claim) => executionTransaction(db, claim.serviceId, async (tx, now) => {
      const control = await readExecutionControl(tx, claim.serviceId);
      if (!claim.dispatched && (control || claim.epoch !== null) && (!control || control.phase !== 'active' || !liveControl(control, now) || control.epoch !== claim.epoch || (control.handoff && control.handoff.stage !== 'complete'))) return false;
      const subtask = (await tx.select().from(tasks).where(eq(tasks.id, claim.subtaskId)).for('update'))[0];
      if (!claim.dispatched && (!subtask || subtask.view.state !== 'awaiting-input' || subtask.view.cancelRequestedAt)) return false;
      return (await tx.update(messages).set({ dispatched: true }).where(leased(claim)).returning()).length === 1;
    }),
    settle: async (claim, state, errorCode) => (await db.update(messages).set({ state, errorCode: errorCode ?? null, owner: null, leaseUntil: null, updatedAt: sql`clock_timestamp()` }).where(leased(claim)).returning()).length === 1,
  };
}
async function claimMessage(db: Database, owner: string, id?: string): Promise<ExecutionMessage | undefined> {
  const candidates = await db.select({ id: messages.id, serviceId: messages.serviceId }).from(messages).where(and(ready(), id ? eq(messages.id, id) : undefined)).orderBy(asc(messages.updatedAt)).limit(100);
  for (const candidate of candidates) {
    const claimed = await executionTransaction(db, candidate.serviceId, async (tx, now) => {
      const row = (await tx.select().from(messages).where(and(eq(messages.id, candidate.id), ready())).for('update', { skipLocked: true }))[0];
      if (!row) return undefined;
      if (!row.dispatched) {
        const control = await readExecutionControl(tx, row.serviceId);
        if ((control || row.epoch !== null) && (!control || control.phase !== 'active' || !liveControl(control, now) || control.epoch !== row.epoch || (control.handoff && control.handoff.stage !== 'complete'))) return undefined;
      }
      return view((await tx.update(messages).set({ state: 'dispatching', owner, revision: row.revision + 1, leaseUntil: new Date(now.getTime() + 30_000), updatedAt: now }).where(eq(messages.id, row.id)).returning())[0]!);
    });
    if (claimed) return claimed;
  }
  return undefined;
}
