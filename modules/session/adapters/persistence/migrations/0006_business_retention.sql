ALTER TABLE session.business_executions ADD COLUMN consumed_at timestamptz;
ALTER TABLE session.business_executions ADD COLUMN expired boolean NOT NULL DEFAULT false;
CREATE INDEX business_execution_retention ON session.business_executions(consumed_at) WHERE consumed_at IS NOT NULL;
