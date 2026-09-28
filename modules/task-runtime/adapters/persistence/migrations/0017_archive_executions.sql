CREATE TABLE task_runtime.archive_executions (
  id text PRIMARY KEY, task_id text NOT NULL, state text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  CHECK (state IN ('queued', 'admitted', 'stopping', 'stopped'))
);
CREATE UNIQUE INDEX archive_execution_active_task ON task_runtime.archive_executions(task_id) WHERE state <> 'stopped';
CREATE INDEX archive_execution_active ON task_runtime.archive_executions(id) WHERE state <> 'stopped';
CREATE TABLE task_runtime.unprovisioned_storage (
  task_id text PRIMARY KEY,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object')
);
