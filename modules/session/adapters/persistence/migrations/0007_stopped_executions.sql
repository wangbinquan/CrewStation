-- Physical termination may precede the first session receipt. Keep a durable tombstone independently.
CREATE TABLE session.business_stopped_executions (
  task_id text NOT NULL,
  execution_id text NOT NULL,
  stopped_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expired boolean NOT NULL DEFAULT false,
  PRIMARY KEY(task_id, execution_id)
);
