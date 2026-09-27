CREATE TABLE business_task.execution_operations (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  kind text NOT NULL,
  parent_id text NOT NULL,
  request_key text NOT NULL,
  request_digest text NOT NULL,
  effective_digest text NOT NULL,
  intent jsonb NOT NULL,
  epoch integer,
  state text NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'retryable-rejected')),
  revision integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((state = 'running') = (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX execution_operations_request ON business_task.execution_operations(service_id, kind, parent_id, request_key);
CREATE INDEX execution_operations_pending ON business_task.execution_operations(updated_at, id) WHERE state IN ('pending', 'running');
