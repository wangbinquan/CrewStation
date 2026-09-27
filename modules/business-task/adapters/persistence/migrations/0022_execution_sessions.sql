ALTER TABLE business_task.execution_subtasks ADD COLUMN session_key text;
ALTER TABLE business_task.execution_subtasks ADD COLUMN session_volume_uid text;
CREATE TABLE business_task.execution_session_homes (
  session_key text PRIMARY KEY, service_id text NOT NULL, task_id text NOT NULL, volume_uid text NOT NULL,
  lease_execution_id text, state text NOT NULL CHECK (state IN ('occupied','idle','lost')),
  CHECK ((state='occupied') = (lease_execution_id IS NOT NULL))
);
CREATE TABLE business_task.execution_sessions (
  service_id text NOT NULL, task_id text NOT NULL, session_id text NOT NULL, session_key text NOT NULL,
  source_execution_id text NOT NULL, PRIMARY KEY(task_id,session_id)
);
CREATE UNIQUE INDEX execution_subtasks_execution_id ON business_task.execution_subtasks((view->>'executionId'));
