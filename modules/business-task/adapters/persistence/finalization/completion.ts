import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { text, primaryKey } from 'drizzle-orm/pg-core';
import { ExecutionCompletionProofSchema } from '@crewstation/contracts';
import type { ExecutionCompletionProof, TaskId } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, precondition } from '@crewstation/kernel';
import { jsonDocument } from '@crewstation/persistence';
import type { Database, Executor } from '@crewstation/persistence';
import type { FinalizationCompletion } from '../../../ports/storage/completion';
import type { FinalizationOperation } from '../../../domain/finalization/operation';
import { executionTransaction } from '../executionTransaction';
import { businessTaskSchema } from '../schema';
import { executionSubtasks as tasks } from '../execution/subtaskTables';
import { subtaskProjections as projections } from '../execution/projectionTables';
import { executionMessages as messages } from '../messages/tables';
import { finalizations } from './tables';

type Evidence = { subtaskId: string; executionId: string; attempt: number; projectionThrough: number; source: 'session' | 'never-started'; proof: ExecutionCompletionProof | null };
const proofs = businessTaskSchema.table('finalization_execution_proofs', {
  operationId: text('operation_id').notNull(), subtaskId: text('subtask_id').notNull(), body: jsonDocument('body').$type<Evidence>().notNull(),
}, (t) => [primaryKey({ columns: [t.operationId, t.subtaskId] })]);
const BATCH = 20;
function rows(tx: Executor, op: FinalizationOperation) {
  return tx.select({ task: tasks, projection: projections }).from(tasks).leftJoin(projections, eq(projections.subtaskId, tasks.id))
    .where(and(eq(tasks.serviceId, op.serviceId), eq(tasks.taskId, op.view.taskId), op.completionScan?.after ? gt(tasks.id, op.completionScan.after) : undefined)).orderBy(asc(tasks.id)).limit(BATCH);
}
type CompletionRow = Awaited<ReturnType<typeof rows>>[number];
function validate(row: CompletionRow, raw: ExecutionCompletionProof | null): Evidence {
  const t = row.task, p = row.projection;
  if (!['succeeded', 'failed', 'cancelled'].includes(t.view.state) || !['exited', 'not-started'].includes(t.view.process) || t.dispatch !== 'accepted') throw precondition('仍有活动或未知执行，等待应用取消或执行结束', { code: 'finalization_execution_pending' });
  if (!p?.complete || !p.sourceConsumed || !t.view.result) throw precondition('执行结果或持久消费确认尚未齐备', { code: 'finalization_result_pending' });
  if (p.sourceStopped) throw precondition('执行停止后仍有结果缺口，需要补证或明确损失确认', { code: 'finalization_result_incomplete' });
  if (!t.incarnation) {
    if (raw || t.view.process !== 'not-started' || t.view.result.reason !== 'cancelled-before-start' || p.sourceSequence !== 0) throw precondition('缺少执行从未启动的持久证明', { code: 'finalization_never_started_unknown' });
    return { subtaskId: t.id, executionId: t.view.executionId, attempt: t.view.attempt, projectionThrough: 0, source: 'never-started', proof: null };
  }
  const proof = ExecutionCompletionProofSchema.parse(raw), receipt = t.receipt;
  if (!receipt?.result || receipt.phase !== 'finished' || proof.taskId !== (t.runtimeTaskId ?? t.taskId) || proof.executionId !== t.view.executionId || proof.attempt !== t.view.attempt || proof.incarnation !== t.incarnation || proof.payloadDigest !== t.payloadDigest || proof.lastSequence !== p.sourceSequence || proof.lastSequence !== receipt.lastSequence || proof.resultDigest !== jsonHash(receipt.result)) throw conflict('持久终态证明与原执行或投影不符', { code: 'finalization_completion_mismatch' });
  return { subtaskId: t.id, executionId: t.view.executionId, attempt: t.view.attempt, projectionThrough: p.sourceSequence, source: 'session', proof };
}
export function finalizationCompletion(db: Database): FinalizationCompletion {
  return {
    page: async (id) => {
      const operation = (await db.select().from(finalizations).where(eq(finalizations.id, id)))[0]?.body;
      if (!operation) throw notFound('终结操作');
      if (operation.view.phase !== 'draining' || operation.completionScan?.complete) return [];
      return (await rows(db, operation)).map(({ task }) => ({ subtaskId: task.id, executionId: task.view.executionId, executionTaskId: (task.runtimeTaskId ?? task.taskId) as TaskId, state: task.view.state, requiresSessionProof: !!task.incarnation }));
    },
    confirm: async (lease, items) => {
      const current = (await db.select({ serviceId: finalizations.serviceId }).from(finalizations).where(eq(finalizations.id, lease.id)))[0];
      if (!current) return undefined;
      return executionTransaction(db, current.serviceId, async (tx, now) => {
        const row = (await tx.select().from(finalizations).where(and(eq(finalizations.id, lease.id), eq(finalizations.sequence, lease.sequence), eq(finalizations.leaseOwner, lease.owner), gt(finalizations.leaseUntil, now))).for('update'))[0];
        if (!row || row.body.view.revision !== lease.revision || row.phase !== 'draining') return undefined;
        const op = row.body;
        if (op.completionScan?.complete) { if (items.length) throw conflict('终态扫描已封存'); return op; }
        const batch = await rows(tx, op);
        if (items.length !== batch.length || items.some((item, i) => item.subtaskId !== batch[i]!.task.id)) throw conflict('终态证明分页已变化或缺少执行', { code: 'finalization_completion_page_changed' });
        const evidence = batch.map((item, i) => validate(item, items[i]!.proof));
        const scan = op.completionScan ?? { after: null, digest: jsonHash({ operationId: op.id, taskId: op.view.taskId, generation: op.view.taskGeneration }), count: 0, complete: false };
        let digest = scan.digest;
        for (const item of evidence) {
          await tx.insert(proofs).values({ operationId: op.id, subtaskId: item.subtaskId, body: item });
          digest = jsonHash({ previous: digest, proof: item });
        }
        const complete = batch.length < BATCH;
        if (complete && (await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.serviceId, op.serviceId), eq(messages.taskId, op.view.taskId), sql`${messages.state} NOT IN ('succeeded','failed')`)).limit(1)).length) throw precondition('仍有未确认的追加消息', { code: 'finalization_message_pending' });
        const body: FinalizationOperation = { ...op, completionScan: { after: batch.at(-1)?.task.id ?? scan.after, digest, count: scan.count + batch.length, complete }, evidence: { ...op.evidence, ...(complete ? { completionProofDigest: digest } : {}) } };
        await tx.update(finalizations).set({ body }).where(eq(finalizations.id, op.id));
        return body;
      });
    },
  };
}
