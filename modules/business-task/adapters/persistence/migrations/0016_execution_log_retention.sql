ALTER TABLE business_task.execution_events ALTER COLUMN subtask_id DROP NOT NULL;
CREATE UNIQUE INDEX execution_events_source_id ON business_task.execution_events(task_id, (event->>'sourceEventId'));
CREATE TABLE business_task.execution_logs (
  task_id text PRIMARY KEY, service_id text NOT NULL, generation integer NOT NULL DEFAULT 1,
  high_watermark integer NOT NULL DEFAULT 0, expired boolean NOT NULL DEFAULT false, closed_at timestamptz,
  CHECK (generation > 0 AND high_watermark >= 0)
);
INSERT INTO business_task.execution_logs(task_id, service_id, high_watermark)
SELECT task_id, min(service_id), max(sequence) FROM business_task.execution_events GROUP BY task_id;
CREATE INDEX execution_logs_retention ON business_task.execution_logs(closed_at) WHERE closed_at IS NOT NULL;
