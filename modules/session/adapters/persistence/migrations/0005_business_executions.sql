CREATE TABLE session.business_executions (
  task_id text NOT NULL,
  execution_id text NOT NULL,
  receipt jsonb NOT NULL,
  persisted_through bigint NOT NULL DEFAULT 0,
  acknowledged_through bigint NOT NULL DEFAULT 0,
  output_bytes bigint NOT NULL DEFAULT 0,
  complete boolean NOT NULL DEFAULT false,
  polled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, execution_id),
  CHECK (acknowledged_through >= 0 AND acknowledged_through <= persisted_through),
  CHECK (output_bytes >= 0)
);
CREATE INDEX business_executions_poll ON session.business_executions(task_id, polled_at);
CREATE TABLE session.business_execution_events (
  task_id text NOT NULL,
  execution_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  digest text NOT NULL,
  event jsonb NOT NULL,
  PRIMARY KEY (task_id, execution_id, sequence),
  FOREIGN KEY (task_id, execution_id) REFERENCES session.business_executions(task_id, execution_id)
);
