import { and, eq, sql } from 'drizzle-orm';
import type { TaskId } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import type { ImageReferenceQuery, ImageReferenceState } from '../../../ports/imageReferenceState';
import { executionOperations as parents } from '../executionTables';
import { executionTaskStates as states } from './lifecycleTables';
import { executionSubtasks as agents } from './subtaskTables';

/** Only irreversible lifecycle closure is a tombstone. Terminal Agents can still be retried while their parent is open. */
export function drizzleImageReferenceState(db: Database) {
  return async (input: ImageReferenceQuery): Promise<ImageReferenceState> => {
    if (!['task', 'agent'].includes(input.ownerType)) return 'unknown';
    const agent = input.ownerType === 'agent' ? (await db.select().from(agents).where(eq(agents.runtimeTaskId, input.ownerId as TaskId)))[0] : undefined;
    if (input.ownerType === 'agent' && (!agent || agent.view.runtimeImage?.versionId !== input.versionId)) return 'unknown';
    const taskId = agent?.taskId ?? input.ownerId;
    const row = (await db.select({ parent: parents, task: states }).from(parents).leftJoin(states, eq(states.taskId, taskId))
      .where(and(eq(parents.kind, 'create-task'), sql`${parents.intent}->'task'->>'id' = ${taskId}`)))[0];
    if (!row || row.parent.intent.projectId !== input.projectId || (input.ownerType === 'task' && row.parent.intent.task.runtimeImage?.versionId !== input.versionId)) return 'unknown';
    if (row.task?.state === 'closed' && !row.task.operationId) return !agent || agent.runtimeReleased ? 'released' : 'active';
    // Failed admission may hide an ambiguous remote effect; never treat a missing runtime as proof.
    return row.parent.state === 'failed' ? 'unknown' : 'active';
  };
}
