CREATE TABLE business_task.legacy_mutations (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  kind text NOT NULL,
  task_id text,
  state text NOT NULL CHECK (state IN ('open', 'unknown', 'complete')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX legacy_mutations_unsettled ON business_task.legacy_mutations(service_id, created_at)
  WHERE state <> 'complete';
