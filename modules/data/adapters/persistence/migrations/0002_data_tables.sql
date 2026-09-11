CREATE TABLE IF NOT EXISTS data.resources (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  service_id text NOT NULL,
  kind text NOT NULL,
  env text NOT NULL,
  plan text NOT NULL,
  state text NOT NULL,
  env_var text NOT NULL,
  object_name text NOT NULL,
  secret_box text,
  message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS resources_service_env_kind_idx ON data.resources (service_id, env, kind);
CREATE INDEX IF NOT EXISTS resources_project_idx ON data.resources (project_id);
CREATE TABLE IF NOT EXISTS data.task_bindings (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  service_id text NOT NULL,
  project_id text NOT NULL,
  mode text NOT NULL,
  state text NOT NULL,
  reason text,
  decision text,
  requested_by text NOT NULL,
  decided_by text,
  ttl_minutes integer NOT NULL,
  expires_at timestamptz,
  role_name text,
  secret_box text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS task_bindings_task_idx ON data.task_bindings (task_id);
CREATE INDEX IF NOT EXISTS task_bindings_project_state_idx ON data.task_bindings (project_id, state);
