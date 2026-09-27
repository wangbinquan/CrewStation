CREATE TABLE business_task.subtask_projections (
  subtask_id text PRIMARY KEY REFERENCES business_task.execution_subtasks(id),
  source_sequence integer NOT NULL DEFAULT 0,
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  truncated boolean NOT NULL DEFAULT false,
  complete boolean NOT NULL DEFAULT false,
  polled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE business_task.execution_events (
  service_id text NOT NULL,
  task_id text NOT NULL,
  sequence integer NOT NULL,
  subtask_id text NOT NULL,
  source_sequence integer NOT NULL,
  digest text NOT NULL,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id, sequence),
  UNIQUE(subtask_id, source_sequence)
);
CREATE INDEX execution_events_filter ON business_task.execution_events(task_id, subtask_id, sequence);
