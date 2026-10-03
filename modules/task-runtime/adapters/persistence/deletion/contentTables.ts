interface ContentTable {
  readonly table: string;
  readonly keys: readonly string[];
  readonly columns: readonly string[];
  readonly documents: readonly string[];
}
const columns = (value: string) => value.split(' ').sort();
const documents: Readonly<Record<string, readonly string[]>> = {
  environments: ['labels', 'native', 'render', 'legacy_native', 'legacy_cluster', 'parent_ending', 'business_workspace', 'preview', 'release', 'runner_rejection', 'startup', 'runtime_initialization'],
  environment_rebuilds: ['input', 'legacy_input', 'legacy_cluster', 'development_parent_binding'],
  archive_executions: ['body'], unprovisioned_storage: ['body'],
  development_parent_endings: ['epoch', 'intent', 'progress', 'completion_witness'],
  development_parent_ending_children: ['snapshot', 'closure'], development_parent_ending_objects: ['absence'],
  original_callbacks: ['original_process', 'deletion_grant'],
};
const entry = (table: string, keys: readonly string[], names: string): ContentTable => ({ table, keys, columns: columns(names), documents: documents[table] ?? [] });

/** Every current payload column is accounted for, including legacy documents and generated presence witnesses. */
export const RUNTIME_CONTENT: readonly ContentTable[] = [
  entry('environments', ['id'], 'admission_fingerprint branch business_workspace connected created_at created_by id kind labels last_activity_at legacy_cluster legacy_native message namespace native parent_ending parent_ending_kind parent_ending_present pod_name pod_uid preview profile project_id pvc_name rebuild_id release render runner_rejection runner_token_hash runtime_initialization service_id startup state trace_id updated_at volume_mode'),
  entry('admissions', ['project_id'], 'project_id running'),
  entry('environment_rebuilds', ['id'], 'attempts created_at creation development_parent_binding development_parent_binding_kind development_parent_binding_present failure_reason id image input legacy_cluster legacy_input message namespace node_name original_pod_name pod_name pod_uid project_id pvc_name secret_name secret_uid state task_id updated_at'),
  entry('blocked_admissions', ['task_id'], 'blocked_at service_id task_id'),
  entry('archive_executions', ['id'], 'body id state task_id'),
  entry('unprovisioned_storage', ['task_id'], 'body task_id'),
  entry('development_parent_endings', ['id'], 'after_child_id completion_witness created_at epoch epoch_hash id intent member_count membership_frozen membership_revision message operation parent_id phase progress project_id retry_at selection_hash status updated_at'),
  entry('development_parent_ending_children', ['ending_id', 'child_id'], 'child_id closed closure ending_id original_parent_pod_uid snapshot'),
  entry('development_parent_ending_objects', ['ending_id', 'kind', 'namespace', 'name'], 'absence ending_id kind materials_hash name namespace uid'),
  entry('development_parent_rebuild_claims', ['source_ending_id'], 'after_transition_hash current_rebuild_id retry_at revision source_ending_id state'),
  entry('original_callbacks', ['id'], 'backend_pid consumer_id entered_at exit_digest exit_key_hash exited_at deletion_grant id input_digest kind origin_id origin_key origin_kind origin_revision original_process project_id recovery_digest reference'),
];
/** Immutable identities, the global cursor and deletion proof journal survive recoverable project payloads. */
export const RUNTIME_RETAINED = [
  entry('resource_identity_aliases', ['kind', 'key'], 'id key kind'),
  entry('development_parent_recovery_sweep', ['singleton'], 'after_id epoch kind scan_cutoff singleton'),
  entry('work_origins', ['kind', 'key'], 'id identity key kind project_id revision'),
  entry('project_admissions', ['project_id'], 'generation operation_id project_id revision'),
  entry('callback_pod_stops', ['identity'], 'digest identity original_process'),
  entry('project_deletions', ['project_id'], 'body generation operation_id phases project_id revision verified'),
] as const;
