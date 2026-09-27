CREATE TABLE business_task.execution_subtasks (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  task_id text NOT NULL,
  request_key text NOT NULL,
  request_digest text NOT NULL,
  sealed_payload text NOT NULL,
  payload_digest text NOT NULL,
  fenced boolean NOT NULL,
  epoch integer,
  view jsonb NOT NULL,
  dispatch text NOT NULL CHECK (dispatch IN ('pending', 'dispatching', 'accepted', 'unknown', 'failed')),
  incarnation text,
  receipt jsonb,
  revision integer NOT NULL DEFAULT 0,
  owner text,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK ((dispatch = 'dispatching') = (owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX execution_subtasks_request ON business_task.execution_subtasks(service_id, task_id, request_key);
CREATE INDEX execution_subtasks_pending ON business_task.execution_subtasks(updated_at, id) WHERE dispatch IN ('pending', 'dispatching', 'unknown');
