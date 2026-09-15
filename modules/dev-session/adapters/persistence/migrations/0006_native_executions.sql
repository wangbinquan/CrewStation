ALTER TABLE dev_session.native_terminal_starts ADD COLUMN execution jsonb;
ALTER TABLE dev_session.native_terminal_starts ADD COLUMN execution_task_id text;
ALTER TABLE dev_session.native_terminal_starts ADD COLUMN snapshot jsonb;
CREATE UNIQUE INDEX native_terminal_execution ON dev_session.native_terminal_starts (execution_task_id);
CREATE TABLE dev_session.native_activity_sources (
  task_id text NOT NULL,
  source_task_id text NOT NULL,
  through_seq bigint NOT NULL DEFAULT 0,
  complete boolean NOT NULL DEFAULT false,
  PRIMARY KEY (task_id, source_task_id)
);
INSERT INTO dev_session.native_activity_sources (task_id, source_task_id, through_seq)
SELECT task_id, task_id, through_seq FROM dev_session.native_activity_progress;
