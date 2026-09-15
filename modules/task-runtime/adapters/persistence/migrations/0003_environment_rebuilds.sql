ALTER TABLE task_runtime.environments ADD COLUMN IF NOT EXISTS rebuild_id text;

CREATE TABLE IF NOT EXISTS task_runtime.environment_rebuilds (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  project_id text NOT NULL,
  input jsonb NOT NULL,
  namespace text NOT NULL,
  original_pod_name text NOT NULL,
  pod_name text NOT NULL,
  pvc_name text NOT NULL,
  secret_name text NOT NULL,
  image text NOT NULL,
  state text NOT NULL,
  pod_uid text,
  secret_uid text,
  message text,
  failure_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS environment_rebuilds_active_task
  ON task_runtime.environment_rebuilds (task_id) WHERE state IN ('queued', 'replacing', 'starting');
