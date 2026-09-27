CREATE TABLE business_task.execution_cancellations (
  id text PRIMARY KEY, service_id text NOT NULL, task_id text NOT NULL, subtask_id text NOT NULL,
  request_key text NOT NULL, request_digest text NOT NULL, expected_attempt integer NOT NULL, epoch integer,
  state text NOT NULL CHECK (state IN ('pending','dispatching','awaiting','succeeded')),
  error_code text, owner text, revision integer NOT NULL DEFAULT 0, lease_until timestamptz, updated_at timestamptz NOT NULL,
  CHECK ((state='dispatching') = (owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX execution_cancellations_request ON business_task.execution_cancellations(service_id,subtask_id,request_key);
CREATE INDEX execution_cancellations_pending ON business_task.execution_cancellations(updated_at,id) WHERE state<>'succeeded';
