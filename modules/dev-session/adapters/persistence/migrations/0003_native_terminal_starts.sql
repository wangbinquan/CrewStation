CREATE TABLE dev_session.native_terminal_starts (
  agent_id text PRIMARY KEY,
  task_id text NOT NULL,
  created_by text NOT NULL,
  client_request_id text NOT NULL,
  fingerprint text NOT NULL,
  input jsonb NOT NULL,
  driver text NOT NULL,
  model text NOT NULL,
  record jsonb NOT NULL
);
CREATE UNIQUE INDEX native_terminal_request ON dev_session.native_terminal_starts (task_id, created_by, client_request_id);
CREATE INDEX native_terminal_task ON dev_session.native_terminal_starts (task_id);
