CREATE TABLE business_task.recovery_requests (
  id text PRIMARY KEY, service_id text NOT NULL, project_id text NOT NULL,
  task_id text NOT NULL, target_key text NOT NULL, request_key text NOT NULL,
  request_digest text NOT NULL, requested_by text NOT NULL, target jsonb NOT NULL,
  assessment_digest text NOT NULL, state text NOT NULL CHECK (state IN ('pending','claimed','running','succeeded','failed','rejected')),
  claim_id text, claim_epoch bigint, claim_holder text, claim_pod_uid text, lease_until timestamptz,
  operation_id text, result_task_id text, result_subtask_id text, reason text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, observed_at timestamptz,
  UNIQUE(service_id, request_key)
);
CREATE UNIQUE INDEX recovery_requests_active_target ON business_task.recovery_requests(service_id, task_id, target_key)
  WHERE state IN ('pending','claimed','running');
CREATE INDEX recovery_requests_queue ON business_task.recovery_requests(service_id, state, created_at, id);
CREATE INDEX recovery_requests_task ON business_task.recovery_requests(service_id, task_id, created_at, id);
CREATE TABLE business_task.recovery_audit (
  id text PRIMARY KEY, request_id text NOT NULL REFERENCES business_task.recovery_requests(id),
  event text NOT NULL CHECK (event IN ('requested','claimed','running','succeeded','failed','rejected')),
  actor text NOT NULL, epoch bigint, at timestamptz NOT NULL
);
CREATE INDEX recovery_audit_request ON business_task.recovery_audit(request_id, at, id);
