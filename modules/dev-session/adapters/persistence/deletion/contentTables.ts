interface ContentTable {
  readonly table: string;
  readonly keys: readonly string[];
  readonly from?: string;
  readonly workspace?: string;
  readonly runtime?: string;
  readonly previous?: string;
  readonly operation?: string;
  readonly project?: string;
  readonly agent?: string;
  readonly legacyAgent?: string;
  readonly invalid?: string;
  readonly optionalWorkspace?: boolean;
}
const workspace = (table: string, keys = ['task_id']): ContentTable => ({ table, keys, workspace: 'r.task_id' });
const terminalChild = (table: string, keys: string[], invalid = 'false'): ContentTable => ({ ...workspace(table, keys),
  agent: 'r.agent_id',
  from: `dev_session.${table} r LEFT JOIN dev_session.native_terminal_starts p ON p.agent_id=r.agent_id AND p.task_id=r.task_id`,
  invalid: `p.agent_id IS NULL OR (${invalid})` });
const executionMismatch = "r.execution->>'taskId' IS DISTINCT FROM r.execution_task_id";
const duplicateExecution = (other: string) => `EXISTS(SELECT 1 FROM dev_session.${other} c WHERE c.execution_task_id=r.execution_task_id OR c.agent_id=r.agent_id)`;
const usageMismatch = "r.workspace_task_id IS DISTINCT FROM p.task_id OR r.prepared->'intent'->'identity'->>'taskId' IS DISTINCT FROM p.task_id OR r.prepared->'intent'->'identity'->>'agentId' IS DISTINCT FROM p.agent_id OR r.prepared->'intent'->'identity'->>'projectId' IS DISTINCT FROM r.project_id OR r.prepared->'intent'->'identity'->>'executionId' IS DISTINCT FROM r.execution_task_id OR (r.binding IS NOT NULL AND r.binding->'identity' IS DISTINCT FROM r.prepared->'intent'->'identity')";

export const DEVELOPMENT_CONTENT: readonly ContentTable[] = [
  workspace('idle_reminders'),
  { ...workspace('native_terminal_starts', ['agent_id']), runtime: 'r.execution_task_id', previous: "r.execution->>'previousTaskId'",
    agent: 'r.agent_id', legacyAgent: "r.legacy_record->>'agentId'",
    invalid: `${executionMismatch} OR (r.execution IS NULL) IS DISTINCT FROM (r.execution_task_id IS NULL) OR r.record->>'agentId' IS DISTINCT FROM r.agent_id OR ${duplicateExecution('agent_starts')}` },
  workspace('workspace_layouts', ['task_id', 'user_id']),
  workspace('native_activity_progress'),
  { ...terminalChild('native_activity_states', ['task_id', 'agent_id'], "r.projection->'state'->>'agentId' IS DISTINCT FROM r.agent_id"), legacyAgent: "r.legacy_projection->'state'->>'agentId'" },
  { ...terminalChild('native_activity_items', ['task_id', 'seq'], "r.item->>'agentId' IS DISTINCT FROM r.agent_id OR r.item->>'eventId' IS DISTINCT FROM r.event_id"), legacyAgent: "r.legacy_item->>'agentId'" },
  terminalChild('native_activity_reads', ['task_id', 'user_id', 'agent_id', 'turn_id']),
  { ...workspace('native_activity_sources', ['task_id', 'source_task_id']), runtime: 'r.source_task_id',
    invalid: 'r.source_task_id<>r.task_id AND NOT EXISTS(SELECT 1 FROM dev_session.native_terminal_starts p WHERE p.task_id=r.task_id AND p.execution_task_id=r.source_task_id)' },
  { ...workspace('agent_starts', ['agent_id']), runtime: 'r.execution_task_id', previous: "r.execution->>'previousTaskId'",
    agent: 'r.agent_id',
    invalid: `${executionMismatch} OR ${duplicateExecution('native_terminal_starts')}` },
  workspace('comparison_references', ['id']),
  { table: 'cluster_agent_restarts', keys: ['operation_id'], operation: 'r.operation_id', runtime: 'r.task_id',
    agent: 'r.agent_id',
    invalid: 'EXISTS(SELECT 1 FROM dev_session.agent_starts p WHERE p.agent_id=r.agent_id AND p.execution_task_id<>r.task_id)' },
  { table: 'development_agent_usage', keys: ['execution_task_id'], workspace: 'p.task_id', runtime: 'r.execution_task_id', project: 'r.project_id',
    from: 'dev_session.development_agent_usage r LEFT JOIN dev_session.agent_starts p ON p.execution_task_id=r.execution_task_id',
    invalid: 'p.agent_id IS NULL OR ' + usageMismatch },
  { table: 'development_agent_endings', keys: ['execution_task_id'], workspace: 'p.task_id', runtime: 'r.execution_task_id', project: 'u.project_id',
    from: 'dev_session.development_agent_endings r LEFT JOIN dev_session.development_agent_usage u ON u.execution_task_id=r.execution_task_id LEFT JOIN dev_session.agent_starts p ON p.execution_task_id=r.execution_task_id',
    invalid: "u.execution_task_id IS NULL OR p.agent_id IS NULL OR u.workspace_task_id IS DISTINCT FROM p.task_id OR u.prepared->'intent'->'identity'->>'agentId' IS DISTINCT FROM p.agent_id" },
  { table: 'original_callbacks', keys: ['id'], project: 'r.project_id',
    optionalWorkspace: true,
    from: 'dev_session.original_callbacks r LEFT JOIN dev_session.content_origins p ON p.kind=r.origin_kind AND p.key=r.origin_key',
    workspace: "CASE WHEN r.origin_kind='task' THEN r.origin_key ELSE NULL END",
    operation: "CASE WHEN r.origin_kind='cluster-operation' THEN r.origin_key ELSE NULL END",
    invalid: "r.origin_kind NOT IN('project','task','cluster-operation') OR p.id IS DISTINCT FROM r.origin_id OR p.project_id IS DISTINCT FROM r.project_id OR (r.origin_kind='project' AND r.origin_id<>r.project_id)" },
];
