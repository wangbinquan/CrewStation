/** Every content table has an explicit primary key and ownership projection. Child ownership uses only this schema. */
interface ContentTable {
  readonly table: string;
  readonly keys: readonly string[];
  readonly from?: string;
  readonly service?: string;
  readonly project?: string;
  readonly task?: string;
  readonly runtime?: string;
  readonly invalid?: string;
}
const serviceTask = (table: string, keys = ['id']): ContentTable => ({ table, keys, service: 'r.service_id', task: 'r.task_id' });
const child = (table: string, keys: string[], parent: string, join: string, project?: string): ContentTable => ({ table, keys,
  from: `business_task.${table} r LEFT JOIN business_task.${parent} p ON ${join}`, service: 'p.service_id', task: 'p.task_id', project });
const childMismatch = "NOT EXISTS(SELECT 1 FROM business_task.execution_subtasks c WHERE c.id=r.subtask_id AND c.task_id=r.task_id AND c.service_id=r.service_id)";

export const BUSINESS_CONTENT: readonly ContentTable[] = [
  { table: 'tasks', keys: ['id'], service: 'r.service_id', project: 'r.project_id', task: 'r.id' },
  { table: 'original_callbacks', keys: ['id'], service: 'r.service_id', project: 'r.project_id' },
  { table: 'subtasks', keys: ['id'], task: 'r.task_id', runtime: "r.spec->'execution'->>'taskId'" },
  { table: 'contracts', keys: ['release_id'], service: 'r.service_id' },
  { table: 'cluster_commands', keys: ['id'], runtime: "r.body->'operation'->'target'->>'taskId'" },
  { table: 'execution_operations', keys: ['id'], service: 'r.service_id', project: "r.intent->>'projectId'", task: "r.intent->'task'->>'id'",
    invalid: "r.kind <> 'create-task' OR r.intent->'task'->>'serviceId' IS DISTINCT FROM r.service_id OR r.intent->>'projectId' IS NULL OR r.intent->'task'->>'id' IS NULL" },
  { table: 'execution_controls', keys: ['service_id'], service: 'r.service_id' },
  { table: 'legacy_mutations', keys: ['id'], service: 'r.service_id', runtime: 'r.task_id' },
  { ...serviceTask('execution_subtasks'), runtime: 'r.runtime_task_id', invalid: "r.view->>'id' IS DISTINCT FROM r.id OR r.view->>'taskId' IS DISTINCT FROM r.task_id OR (r.session_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_task.execution_session_homes h WHERE h.session_key=r.session_key AND h.service_id=r.service_id AND h.task_id=r.task_id AND h.volume_uid=r.session_volume_uid))" },
  child('subtask_projections', ['subtask_id'], 'execution_subtasks', 'p.id=r.subtask_id'),
  { ...serviceTask('execution_events', ['task_id', 'sequence']), invalid: 'r.subtask_id IS NOT NULL AND ' + childMismatch },
  { ...serviceTask('execution_cancellations'), invalid: childMismatch },
  serviceTask('execution_task_states', ['task_id']),
  serviceTask('execution_lifecycles'),
  serviceTask('execution_logs', ['task_id']),
  serviceTask('execution_materials'),
  { ...serviceTask('execution_messages'), runtime: 'r.runtime_task_id', invalid: childMismatch },
  { ...serviceTask('execution_session_homes', ['session_key']), runtime: 'r.session_key',
    invalid: "r.lease_execution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_task.execution_subtasks c WHERE c.view->>'executionId'=r.lease_execution_id AND c.task_id=r.task_id AND c.service_id=r.service_id AND c.session_key=r.session_key)" },
  { ...serviceTask('execution_sessions', ['task_id', 'session_id']), runtime: 'r.session_key',
    invalid: "NOT EXISTS(SELECT 1 FROM business_task.execution_session_homes h WHERE h.session_key=r.session_key AND h.task_id=r.task_id AND h.service_id=r.service_id) OR NOT EXISTS(SELECT 1 FROM business_task.execution_subtasks c WHERE c.view->>'executionId'=r.source_execution_id AND c.task_id=r.task_id AND c.service_id=r.service_id AND c.session_key=r.session_key)" },
  { ...serviceTask('recovery_requests'), project: 'r.project_id' },
  child('recovery_audit', ['id'], 'recovery_requests', 'p.id=r.request_id', 'p.project_id'),
  { table: 'storage_control_outbox', keys: ['service_id'], service: 'r.service_id' },
  { ...serviceTask('finalizations'), project: "r.body->>'projectId'",
    invalid: "r.body->>'id' IS DISTINCT FROM r.id OR r.body->>'serviceId' IS DISTINCT FROM r.service_id OR r.body->'view'->>'taskId' IS DISTINCT FROM r.task_id OR r.body->>'projectId' IS NULL" },
  { ...child('finalization_execution_proofs', ['operation_id', 'subtask_id'], 'finalizations', 'p.id=r.operation_id', "p.body->>'projectId'"),
    invalid: "NOT EXISTS(SELECT 1 FROM business_task.execution_subtasks c WHERE c.id=r.subtask_id AND c.task_id=p.task_id AND c.service_id=p.service_id)" },
  child('finalization_revisions', ['id'], 'finalizations', 'p.id=r.finalization_id', "p.body->>'projectId'"),
];
