CREATE TABLE IF NOT EXISTS task_runtime.environments (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  service_id text NOT NULL,
  kind text NOT NULL,
  state text NOT NULL,
  volume_mode text NOT NULL,
  profile text NOT NULL,
  namespace text NOT NULL,
  pod_name text NOT NULL,
  pvc_name text NOT NULL,
  trace_id text NOT NULL,
  runner_token_hash text NOT NULL,
  connected boolean NOT NULL DEFAULT false,
  branch text,
  preview jsonb,
  labels jsonb NOT NULL,
  created_by text,
  message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS environments_project_state_idx ON task_runtime.environments (project_id, state);
CREATE INDEX IF NOT EXISTS environments_state_idx ON task_runtime.environments (state);
CREATE INDEX IF NOT EXISTS environments_trace_idx ON task_runtime.environments (trace_id);
CREATE TABLE IF NOT EXISTS task_runtime.admissions (
  project_id text PRIMARY KEY,
  running integer NOT NULL DEFAULT 0
);
