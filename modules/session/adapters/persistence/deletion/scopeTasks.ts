import { ProjectDeletionSessionTasksSchema } from '@crewstation/contracts';
import type { ProjectId, TaskId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { SessionDeletionScope } from '../../../ports/projectDeletion';

/** A missing stream or an unreadable legacy key must never turn existing numerical rows into EOF. */
export async function readOriginalSessionTasks(tx: Executor, projectId: ProjectId, scope: SessionDeletionScope, after: TaskId | null): Promise<TaskId[]> {
  if (!scope.taskKeys.length) return [];
  const keys = sql.join(scope.taskKeys.map((key) => sql`${key}`), sql`, `);
  const origins = await tx.execute<{ task_key: string; task_id: string; project_id: string | null }>(sql`SELECT task_key,task_id,project_id FROM session.task_origins WHERE task_key IN (${keys})`);
  if (origins.length !== scope.taskKeys.length || origins.some((origin) => origin.project_id !== projectId)) throw precondition('原封写任务目录不完整或归属变化');
  const [invalid] = await tx.execute<{ invalid: boolean }>(sql`SELECT
    EXISTS(SELECT 1 FROM session.business_usage_events e LEFT JOIN session.business_executions b USING(task_id,execution_id)
      LEFT JOIN session.business_usage_sources s USING(task_id,execution_id) WHERE e.task_id IN (${keys}) AND (b.task_id IS NULL OR s.task_id IS NULL OR e.sequence>b.persisted_through))
    OR EXISTS(SELECT 1 FROM session.business_usage_sources s LEFT JOIN session.business_executions b USING(task_id,execution_id) WHERE s.task_id IN (${keys}) AND b.task_id IS NULL)
    OR EXISTS(SELECT 1 FROM session.development_usage_events e LEFT JOIN session.development_usage_streams s USING(task_id) WHERE e.task_id IN (${keys}) AND (s.task_id IS NULL OR e.sequence>s.persisted_through))
    OR EXISTS(SELECT 1 FROM session.task_origins o WHERE o.task_key IN (${keys}) AND o.task_key<>o.task_id AND (
      EXISTS(SELECT 1 FROM session.business_executions b WHERE b.task_id=o.task_key) OR EXISTS(SELECT 1 FROM session.development_usage_streams d WHERE d.task_id=o.task_key))) AS invalid`);
  if (invalid?.invalid !== false) throw precondition('原数字范围存在缺失登记、水位冲突或尚未接入的旧任务键，不能证明排空');
  return ProjectDeletionSessionTasksSchema.parse([...new Set(origins.map((origin) => origin.task_id))].sort().filter((id) => after === null || id > after).slice(0, 200));
}
