import { persistExecutionControl } from './control-projection/repository';
import { and, eq, sql } from 'drizzle-orm';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { ExecutionControls } from '../../ports/executionControl';
import { freezeMigration, migrationReady } from '../../domain/migrationControl';
import { executionOperations as ops } from './executionTables';
import { executionTaskStates } from './execution/lifecycleTables';
import { executionTransaction, readExecutionControl } from './executionTransaction';
import { tasks, subtasks } from './tables';
import { executionSubtasks } from './execution/subtaskTables';

export function migrationControlRepository(db: Database, projectStorage = false): Pick<ExecutionControls, 'freezeMigration' | 'migrationReady' | 'writerRuntimes'> {
  return {
    freezeMigration: (id, request) => executionTransaction(db, id, async (tx, now) => {
      const current = await readExecutionControl(tx, id); if (!current) throw precondition('迁移前必须先由应用启用执行屏障');
      const control = await persistExecutionControl(tx, freezeMigration(current, request), current, projectStorage);
      return { control, now };
    }),
    migrationReady: (id, source, input) => executionTransaction(db, id, async (tx, now) => {
      const current = await readExecutionControl(tx, id); if (!current) throw precondition('服务尚无执行控制记录');
      const control = await persistExecutionControl(tx, migrationReady(current, source, input), current, projectStorage);
      return { control, now };
    }),
    writerRuntimes: async (id) => {
      const parents = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.serviceId, id), sql`${tasks.state} <> 'closed'`));
      const v3 = await db.select({ intent: ops.intent }).from(ops).leftJoin(executionTaskStates, sql`${ops.intent}->'task'->>'id' = ${executionTaskStates.taskId}`).where(and(eq(ops.serviceId, id), eq(ops.state, 'succeeded'), sql`COALESCE(${executionTaskStates.state}, '') <> 'closed'`));
      const legacy = await db.select({ spec: subtasks.spec }).from(subtasks).innerJoin(tasks, eq(subtasks.taskId, tasks.id)).where(eq(tasks.serviceId, id));
      const agents = await db.select({ id: executionSubtasks.runtimeTaskId }).from(executionSubtasks).where(and(eq(executionSubtasks.serviceId, id), eq(executionSubtasks.runtimeDispatched, true), eq(executionSubtasks.runtimeReleased, false)));
      const legacyIds = legacy.flatMap(({ spec }) => { const execution = (spec as { execution?: { taskId: string; released?: boolean } }).execution; return execution && !execution.released ? [execution.taskId] : []; });
      return [...new Set([...parents.map((row) => row.id), ...v3.map((row) => row.intent.task.id), ...legacyIds, ...agents.flatMap((row) => row.id ? [row.id] : [])])];
    },
  };
}
