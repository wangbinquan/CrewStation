CREATE TABLE session.development_usage_streams (
  task_id text PRIMARY KEY,
  registration jsonb NOT NULL,
  receipt jsonb,
  persisted_through bigint NOT NULL DEFAULT 0,
  runner_acknowledged_through bigint NOT NULL DEFAULT 0,
  source_acknowledged_through bigint NOT NULL DEFAULT 0,
  offered_through bigint NOT NULL DEFAULT 0,
  complete boolean NOT NULL DEFAULT false,
  drain_reason text,
  loss jsonb,
  closure jsonb,
  polled_at timestamptz NOT NULL DEFAULT now(),
  source_polled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (persisted_through >= 0),
  CHECK (runner_acknowledged_through BETWEEN 0 AND persisted_through),
  CHECK (source_acknowledged_through BETWEEN 0 AND offered_through),
  CHECK (offered_through BETWEEN 0 AND persisted_through)
);
CREATE INDEX development_usage_poll ON session.development_usage_streams (polled_at, task_id);
CREATE INDEX development_usage_source_poll ON session.development_usage_streams (source_polled_at, task_id);
CREATE TABLE session.development_usage_events (
  task_id text NOT NULL REFERENCES session.development_usage_streams(task_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  digest text NOT NULL,
  event jsonb NOT NULL,
  PRIMARY KEY (task_id, sequence)
);
