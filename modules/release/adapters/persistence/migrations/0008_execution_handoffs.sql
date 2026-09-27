CREATE TABLE release.execution_handoffs (
  id text PRIMARY KEY, request_key text NOT NULL, service_id text NOT NULL, stage text NOT NULL CHECK (stage IN ('freezing','preparing','routing','activating','complete')),
  body jsonb NOT NULL, revision integer NOT NULL DEFAULT 0, owner text, lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_execution_handoff_per_service ON release.execution_handoffs(service_id) WHERE stage <> 'complete';
CREATE INDEX pending_execution_handoffs ON release.execution_handoffs(updated_at) WHERE stage <> 'complete';
CREATE UNIQUE INDEX execution_handoff_request_key ON release.execution_handoffs(service_id,request_key);
