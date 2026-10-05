import { and, eq, sql } from 'drizzle-orm';
import { primaryKey, text } from 'drizzle-orm/pg-core';
import type { ExecutionCompletionProof, TaskId } from '@crewstation/contracts';
import { ExecutionCompletionProofSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import { jsonDocument } from '@crewstation/persistence';
import type { Database, Executor } from '@crewstation/persistence';
import { sessionSchema } from './schema';
import type { businessExecutions } from './businessTables';

const proofs = sessionSchema.table('execution_completion_proofs', {
  taskId: text('task_id').notNull(), executionId: text('execution_id').notNull(),
  record: jsonDocument('record').$type<ExecutionCompletionProof>().notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.executionId] })]);

/** Caller holds the stream lock and has validated the product consumer's exact final watermark. */
export async function persistCompletionProof(tx: Executor, row: typeof businessExecutions.$inferSelect, canonicalTaskId?: TaskId): Promise<void> {
  const receipt = row.receipt;
  if (!row.complete || receipt.phase !== 'finished' || !receipt.result || receipt.lastSequence !== row.persistedThrough) throw conflict('执行终态证明缺少完整结果');
  const at = await tx.execute<{ at: string }>(sql`SELECT clock_timestamp()::text AS at`);
  const candidate = ExecutionCompletionProofSchema.parse({ taskId: canonicalTaskId ?? row.taskId, executionId: row.executionId, attempt: receipt.attempt,
    incarnation: receipt.incarnation, payloadDigest: receipt.payloadDigest, lastSequence: receipt.lastSequence,
    resultDigest: jsonHash(receipt.result), complete: true, persistedAt: new Date(at[0]!.at).toISOString() });
  await tx.insert(proofs).values({ taskId: row.taskId, executionId: row.executionId, record: candidate }).onConflictDoNothing();
  const [stored] = await tx.select().from(proofs).where(and(eq(proofs.taskId, row.taskId), eq(proofs.executionId, row.executionId)));
  if (stored && canonicalTaskId && stored.record.taskId !== row.taskId && stored.record.taskId !== canonicalTaskId) throw conflict('原终态证明属于另一任务');
  if (!stored || jsonHash({ ...stored.record, taskId: canonicalTaskId ?? stored.record.taskId, persistedAt: candidate.persistedAt }) !== jsonHash(candidate)) throw conflict('执行终态证明不可修改');
}

/** No raw-log read, recovery or lazy mutation; an absent proof remains absent. */
export async function readCompletionProof(db: Database, taskId: string, executionId: string, canonicalTaskId?: TaskId): Promise<ExecutionCompletionProof | undefined> {
  const [row] = await db.select().from(proofs).where(and(eq(proofs.taskId, taskId), eq(proofs.executionId, executionId)));
  if (!row) return undefined;
  if (row.record.executionId !== executionId) throw precondition('原终态证明属于另一执行');
  if (canonicalTaskId && row.record.taskId !== taskId && row.record.taskId !== canonicalTaskId) throw precondition('原终态证明属于另一任务');
  return ExecutionCompletionProofSchema.parse({ ...row.record, taskId: canonicalTaskId ?? row.record.taskId });
}
