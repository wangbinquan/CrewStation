import { nextLogSequence } from './logEvents';
import { eq } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import { jsonHash } from '@crewstation/kernel';
import { executionCursor } from '../../../domain/executionCursor';
import { executionSubtasks as tasks } from './subtaskTables';
import { businessEvents as events, subtaskProjections as projections } from './projectionTables';
import type { BusinessEvent } from '@crewstation/contracts';

/** Caller holds the service lock and subtask row. Null incarnation proves start RPC was never authorized. */
export async function cancelBeforeStart(tx: Executor, row: typeof tasks.$inferSelect, now: Date): Promise<void> {
  const { sequence, generation } = await nextLogSequence(tx, row.serviceId, row.taskId), cursor = executionCursor(row.taskId, sequence, undefined, generation);
  const result = { exitCode: null, reason: 'cancelled-before-start', stdout: '', stderr: '', truncated: false, files: [], finalCursor: cursor };
  const view = { ...row.view, state: 'cancelled' as const, process: 'not-started' as const, cancelRequestedAt: row.view.cancelRequestedAt ?? now.toISOString(), endedAt: now.toISOString(), result };
  const event: BusinessEvent = { taskId: view.taskId, subtaskId: view.id, attempt: view.attempt, cursor, occurredAt: now.toISOString(), sourceEventId: `platform:${view.executionId}:cancel-before-start`, type: 'result', data: result };
  await tx.insert(events).values({ serviceId: row.serviceId, taskId: row.taskId, sequence, subtaskId: row.id, sourceSequence: 0, digest: jsonHash(event), event });
  await tx.insert(projections).values({ subtaskId: row.id, complete: true, sourceConsumed: true }).onConflictDoUpdate({ target: projections.subtaskId, set: { complete: true, sourceConsumed: true } });
  await tx.update(tasks).set({ view, dispatch: 'accepted', owner: null, leaseUntil: null, revision: row.revision + 1, updatedAt: now }).where(eq(tasks.id, row.id));
}
