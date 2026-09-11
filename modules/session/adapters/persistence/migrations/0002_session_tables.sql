CREATE TABLE IF NOT EXISTS session.runner_events (
  task_id text NOT NULL,
  seq integer NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  agent_id text,
  event jsonb NOT NULL,
  PRIMARY KEY (task_id, seq)
);
CREATE INDEX IF NOT EXISTS runner_events_task_kind_idx ON session.runner_events (task_id, kind, seq);
CREATE TABLE IF NOT EXISTS session.connections (
  task_id text PRIMARY KEY,
  replica text NOT NULL,
  connected_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);
