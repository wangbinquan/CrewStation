import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database, Transaction } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

async function taskOwnership(tx: Transaction, id: string) {
  const legacy = (await tx.execute<{ project_id: string; service_id: string }>(sql`SELECT project_id,service_id FROM business_task.tasks WHERE id=${id}`))[0];
  const accepted = await tx.execute<{ project_id: string; service_id: string; task_id: string; intent_service: string }>(sql`SELECT intent->>'projectId' AS project_id,service_id,
    intent->'task'->>'id' AS task_id,intent->'task'->>'serviceId' AS intent_service FROM business_task.execution_operations WHERE intent->'task'->>'id'=${id} AND kind='create-task'`);
  const projects = new Set<string>();
  if (legacy) { projects.add(ProjectIdSchema.parse(legacy.project_id)); ServiceIdSchema.parse(legacy.service_id); }
  for (const row of accepted) {
    if (row.task_id !== id || row.intent_service !== row.service_id || legacy && row.service_id !== legacy.service_id) throw precondition('业务任务原受理关系冲突');
    ServiceIdSchema.parse(row.service_id); projects.add(ProjectIdSchema.parse(row.project_id));
  }
  if (projects.size > 1) throw precondition('业务任务原项目归属冲突');
  return [...projects][0];
}

/** Current and legacy business-task storage are read in one actual snapshot, without execution payloads or output. */
export async function businessInfrastructureOrigin(db: Database, kind: 'task' | 'subtask', key: string, representation: 'current' | 'legacy' = 'current') {
  if (!['task', 'subtask'].includes(kind) || !['current', 'legacy'].includes(representation)) throw precondition('业务任务原来源类型未登记');
  if (representation === 'current') ResourceIdSchema.parse(key);
  return db.transaction(async (tx) => {
    const alias = (await tx.execute<{ id: string }>(sql`SELECT id FROM business_task.resource_identity_aliases WHERE kind=${kind} AND key=${JSON.stringify([key])}`))[0]?.id;
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    if (alias && canonical && alias !== canonical) throw precondition('业务任务原标识目录冲突');
    if (!alias && !canonical) return undefined;
    const id = ResourceIdSchema.parse(alias ?? canonical);
    let taskId = id;
    if (kind === 'subtask') {
      const rows = await tx.execute<{ task_id: string; view_id: string; view_task: string }>(sql`SELECT task_id,id AS view_id,task_id AS view_task FROM business_task.subtasks WHERE id=${id}
        UNION SELECT task_id,view->>'id' AS view_id,view->>'taskId' AS view_task FROM business_task.execution_subtasks WHERE id=${id}`);
      if (!rows.length) return undefined;
      if (rows.some((row) => row.view_id !== id || row.view_task !== row.task_id)) throw precondition('业务子任务原受理关系冲突');
      const parents = new Set(rows.map((row) => TaskIdSchema.parse(row.task_id)));
      if (parents.size !== 1) throw precondition('业务子任务原父关系冲突');
      taskId = [...parents][0]!;
    }
    const projectId = await taskOwnership(tx, taskId);
    if (!projectId) return undefined;
    const project = ProjectIdSchema.parse(projectId);
    return { complete: true as const, id, scope: 'project' as const, projectIds: [project], revision: jsonHash({ kind, id, taskId, projectId: project }) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
