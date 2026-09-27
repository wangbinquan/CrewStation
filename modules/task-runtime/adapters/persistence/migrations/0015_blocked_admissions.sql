CREATE TABLE task_runtime.blocked_admissions (
  task_id text PRIMARY KEY,
  service_id text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
