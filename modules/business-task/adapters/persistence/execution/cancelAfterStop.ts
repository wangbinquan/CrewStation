import { eq } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import type { BusinessEvent } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { executionCursor } from '../../../domain/executionCursor';
import { executionSubtasks as tasks } from './subtaskTables';
import { businessEvents as events, subtaskProjections as projections } from './projectionTables';
import { nextLogSequence } from './logEvents';

/** Physical runtime release proves termination, never completeness of its missing output. */
export async function cancelAfterStop(tx: Executor, row: typeof tasks.$inferSelect, now: Date): Promise<void> {
  const summary = (await tx.select().from(projections).where(eq(projections.subtaskId, row.id)).for('update'))[0];
  const nextCursor = async () => {
    const { sequence, generation } = await nextLogSequence(tx, row.serviceId, row.taskId);
    return { sequence, cursor: executionCursor(row.taskId, sequence, undefined, generation) };
  };
  const append = async (sequence: number, sourceSequence: number, event: BusinessEvent) => {
    await tx.insert(events).values({ serviceId: row.serviceId, taskId: row.taskId, sequence, subtaskId: row.id, sourceSequence, digest: jsonHash(event), event });
  };
  const envelope = { taskId: row.view.taskId, subtaskId: row.view.id, attempt: row.view.attempt, occurredAt: now.toISOString() };
  const gap = await nextCursor();
  await append(gap.sequence, -1, { ...envelope, cursor: gap.cursor, sourceEventId: `platform:${row.view.executionId}:runtime-stopped-gap`, type: 'gap',
    data: { reason: 'runtime_stopped_output_incomplete', earliestCursor: gap.cursor, snapshotUrl: `/v3/business-tasks/${row.taskId}/subtasks/${row.id}` } });
  const final = await nextCursor();
  const result = { exitCode: null, reason: 'cancelled-after-runtime-stop', stdout: summary?.stdout ?? '', stderr: summary?.stderr ?? '', truncated: true, files: [], finalCursor: final.cursor };
  await append(final.sequence, 0, { ...envelope, cursor: final.cursor, sourceEventId: `platform:${row.view.executionId}:runtime-stopped-result`, type: 'result', data: result });
  const view = { ...row.view, state: 'cancelled' as const, process: 'exited' as const, endedAt: now.toISOString(), result,
    error: { code: 'execution_output_incomplete', message: '执行环境已停止，部分输出无法恢复' } };
  await tx.insert(projections).values({ subtaskId: row.id, complete: true, sourceStopped: true, truncated: true })
    .onConflictDoUpdate({ target: projections.subtaskId, set: { complete: true, sourceStopped: true, truncated: true, sourceConsumed: false } });
  await tx.update(tasks).set({ view, dispatch: 'accepted', owner: null, leaseUntil: null, revision: row.revision + 1, updatedAt: now }).where(eq(tasks.id, row.id));
}
