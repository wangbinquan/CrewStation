CREATE TABLE IF NOT EXISTS business_task.tasks (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  project_id text NOT NULL,
  caller_identity text NOT NULL,
  state text NOT NULL,
  trace_id text NOT NULL,
  volume_mode text NOT NULL,
  profile text NOT NULL,
  labels jsonb NOT NULL,
  message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON business_task.tasks (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_trace_idx ON business_task.tasks (trace_id);
CREATE TABLE IF NOT EXISTS business_task.subtasks (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  mode text,
  state text NOT NULL,
  attempt integer NOT NULL,
  spec jsonb NOT NULL,
  runner_ref text,
  session_id text,
  exit_code integer,
  output text,
  business_outcome text,
  contract_result jsonb,
  error text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS subtasks_task_idx ON business_task.subtasks (task_id, created_at);
CREATE INDEX IF NOT EXISTS subtasks_state_idx ON business_task.subtasks (state);
CREATE TABLE IF NOT EXISTS business_task.contracts (
  release_id text PRIMARY KEY,
  service_id text NOT NULL,
  tag text NOT NULL,
  agent_profiles jsonb NOT NULL,
  output_contracts jsonb NOT NULL,
  registered_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS contracts_service_idx ON business_task.contracts (service_id, registered_at DESC);
