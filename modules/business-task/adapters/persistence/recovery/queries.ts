import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { RecoveryQueries } from '../../../ports/taskRecovery';
import { recoveryChildStopped } from '../../../domain/taskRecovery';
import { executionOperations } from '../executionTables';
import { toOperation } from '../operationRows';
import { executionSubtasks } from '../execution/subtaskTables';
import { subtaskProjections } from '../execution/projectionTables';

export function recoveryQueries(db: Database): RecoveryQueries {
  return {
    task: async (id) => {
      const row = (await db.select().from(executionOperations).where(and(eq(executionOperations.kind, 'create-task'), sql`${executionOperations.intent}->'task'->>'id' = ${id}`)).limit(1))[0];
      return row && toOperation(row);
    },
    childStopped: async (serviceId, taskId, subtaskId) => {
      const row = (await db.select({ child: executionSubtasks, projection: subtaskProjections }).from(executionSubtasks)
        .leftJoin(subtaskProjections, eq(subtaskProjections.subtaskId, executionSubtasks.id))
        .where(and(eq(executionSubtasks.serviceId, serviceId), eq(executionSubtasks.taskId, taskId), eq(executionSubtasks.id, subtaskId))))[0];
      return Boolean(row && recoveryChildStopped(row.child, row.projection));
    },
  };
}
