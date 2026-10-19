import { nextLogSequence } from './logEvents';
import { eq } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import { jsonHash } from '@crewstation/kernel';
import { executionCursor } from '../../../domain/executionCursor';
import { executionSubtasks as tasks } from './subtaskTables';
import { businessEvents as events, subtaskProjections as projections } from './projectionTables';
import type { BusinessEvent } from '@crewstation/contracts';

/**
 * Caller holds the service lock and the leased subtask row; the start RPC was never authorized. Like a cancel before
 * start, the failure ends with a terminal `result` event: callers follow a subtask's events until its result, and a
 * dispatch failure that only changed the view was never seen to end (AW RFC-370 hosted acceptance, 2026-10-19: an
 * Agent subtask failed with `agent_environment_unavailable` stayed "running" for its caller indefinitely).
 */
export async function failBeforeStart(tx: Executor, row: typeof tasks.$inferSelect, input: { error: { code: string; message: string }; runtimeAdmitted?: boolean }, now: Date): Promise<void> {
  const { sequence, generation } = await nextLogSequence(tx, row.serviceId, row.taskId), cursor = executionCursor(row.taskId, sequence, undefined, generation);
  const result = { exitCode: null, reason: `failed-before-start: ${input.error.code}`, stdout: '', stderr: input.error.message, truncated: false, files: [], finalCursor: cursor };
  const view = { ...row.view, state: 'failed' as const, process: 'not-started' as const, endedAt: now.toISOString(), error: input.error, result };
  const event: BusinessEvent = { taskId: view.taskId, subtaskId: view.id, attempt: view.attempt, cursor, occurredAt: now.toISOString(), sourceEventId: `platform:${view.executionId}:failed-before-start`, type: 'result', data: result };
  await tx.insert(events).values({ serviceId: row.serviceId, taskId: row.taskId, sequence, subtaskId: row.id, sourceSequence: 0, digest: jsonHash(event), event });
  await tx.insert(projections).values({ subtaskId: row.id, complete: true, sourceConsumed: true }).onConflictDoUpdate({ target: projections.subtaskId, set: { complete: true, sourceConsumed: true } });
  await tx.update(tasks).set({ view, dispatch: 'failed', ...(input.runtimeAdmitted ? { runtimeAdmitted: true } : {}), owner: null, leaseUntil: null, revision: row.revision + 1, updatedAt: now }).where(eq(tasks.id, row.id));
}
