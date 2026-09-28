CREATE TABLE business_task.finalizations (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  task_id text NOT NULL UNIQUE,
  body jsonb NOT NULL,
  phase text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finalizations_pending ON business_task.finalizations (next_attempt_at, id) WHERE phase <> 'completed';

CREATE TABLE business_task.finalization_execution_proofs (
  operation_id text NOT NULL REFERENCES business_task.finalizations(id),
  subtask_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (operation_id, subtask_id)
);

CREATE TABLE business_task.finalization_revisions (
  id text PRIMARY KEY, finalization_id text NOT NULL REFERENCES business_task.finalizations(id),
  request_key text NOT NULL, body jsonb NOT NULL,
  UNIQUE(finalization_id, request_key)
);
