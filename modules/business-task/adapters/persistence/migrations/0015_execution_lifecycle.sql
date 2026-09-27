CREATE TABLE business_task.execution_task_states (
  task_id text PRIMARY KEY, service_id text NOT NULL, generation integer NOT NULL CHECK (generation > 0),
  state text NOT NULL, operation_id text
);
CREATE TABLE business_task.execution_lifecycles (
  id text PRIMARY KEY, service_id text NOT NULL, task_id text NOT NULL, action text NOT NULL,
  request_key text NOT NULL, expected_generation integer NOT NULL, generation integer NOT NULL, prior_state text NOT NULL,
  epoch integer, state text NOT NULL, dispatched boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0, owner text, lease_until timestamptz, error_code text, updated_at timestamptz NOT NULL,
  UNIQUE (service_id, task_id, action, request_key)
);
CREATE INDEX execution_lifecycles_pending ON business_task.execution_lifecycles (state, updated_at);
