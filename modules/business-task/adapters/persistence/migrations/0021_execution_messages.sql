CREATE TABLE business_task.execution_messages (
  id text PRIMARY KEY, service_id text NOT NULL, task_id text NOT NULL, subtask_id text NOT NULL,
  request_key text NOT NULL, request_digest text NOT NULL, attempt integer NOT NULL,
  execution_id text NOT NULL, runtime_task_id text NOT NULL, incarnation text NOT NULL,
  payload_digest text NOT NULL, sealed_payload text NOT NULL, epoch integer,
  dispatched boolean NOT NULL DEFAULT false,
  state text NOT NULL CHECK (state IN ('pending','dispatching','awaiting','unknown','succeeded','failed')), error_code text,
  owner text, revision integer NOT NULL DEFAULT 0, lease_until timestamptz, updated_at timestamptz NOT NULL,
  CHECK ((state='dispatching') = (owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX execution_messages_request ON business_task.execution_messages(service_id,subtask_id,request_key);
CREATE INDEX execution_messages_pending ON business_task.execution_messages(updated_at) WHERE state NOT IN ('succeeded','failed');
