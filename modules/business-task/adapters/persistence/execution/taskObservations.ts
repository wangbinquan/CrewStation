import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { ExecutionProjection } from '../../../ports/executionProjection';
import type { ExecutionTaskState } from '../../../domain/executionLifecycle';
import { executionTransaction } from '../executionTransaction';
import { toOperation } from '../operationRows';
import { executionOperations as parents } from '../executionTables';
import { executionTaskStates as states } from './lifecycleTables';
import { executionLogs as logs } from './projectionTables';
import { appendTaskState } from './logEvents';
import { businessAdmissionOpen } from '../deletion/admission';

/** Poll fairly even when one runtime is unreachable; observations never drive lifecycle effects. */
export function taskObservationRepository(db: Database): Pick<ExecutionProjection, 'taskObservations' | 'observeTask'> {
  return {
    taskObservations: () => db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO business_task.execution_logs(task_id,service_id)
        SELECT intent->'task'->>'id',service_id FROM business_task.execution_operations p
        WHERE kind='create-task' AND NOT EXISTS (SELECT 1 FROM business_task.execution_logs l WHERE l.task_id=p.intent->'task'->>'id')
        AND ${businessAdmissionOpen(sql.raw('p.service_id'))}
        ORDER BY created_at LIMIT 100 ON CONFLICT DO NOTHING`);
      const pending = alias(logs, 'pending_task_logs');
      const rows = await tx.select({ parent: parents, lifecycle: states }).from(pending)
        .innerJoin(parents, sql`${parents.intent}->'task'->>'id' = ${pending.taskId}`)
        .leftJoin(states, eq(states.taskId, pending.taskId))
        .where(and(businessAdmissionOpen(parents.serviceId), eq(pending.expired, false), isNull(pending.closedAt)))
        .orderBy(sql`${pending.taskPolledAt} ASC NULLS FIRST`, asc(pending.taskId)).limit(20).for('update', { skipLocked: true, of: pending });
      for (const row of rows) await tx.update(logs).set({ taskPolledAt: sql`clock_timestamp()` }).where(eq(logs.taskId, row.parent.intent.task.id));
      return rows.map(({ parent, lifecycle }) => ({ operation: toOperation(parent), ...(lifecycle ? { lifecycle: lifecycle as ExecutionTaskState } : {}) }));
    }),
    observeTask: (candidate, state) => executionTransaction(db, candidate.operation.serviceId, async (tx, now) => {
      const { operation, lifecycle } = candidate, taskId = operation.intent.task.id;
      const parent = (await tx.select().from(parents).where(eq(parents.id, operation.id)))[0];
      const current = (await tx.select().from(states).where(eq(states.taskId, taskId)))[0];
      // An observation started before a pause/resume or admission result must not overwrite its newer event.
      if (!parent || parent.revision !== operation.revision || parent.state !== operation.state ||
        current?.generation !== lifecycle?.generation || current?.operationId !== lifecycle?.operationId || current?.state !== lifecycle?.state) return false;
      if (current?.operationId) return false;
      const generation = current?.generation ?? operation.intent.task.generation;
      const log = (await tx.select().from(logs).where(eq(logs.taskId, taskId)))[0];
      if (!log || log.expired || log.closedAt || log.taskState === state && log.taskGeneration === generation) return false;
      await appendTaskState(tx, operation.serviceId, taskId, state, generation, `observation:${taskId}:${generation}:${log.highWatermark + 1}`, now);
      return true;
    }),
  };
}
