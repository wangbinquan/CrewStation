CREATE TABLE session.business_usage_sources (
  task_id text NOT NULL,
  execution_id text NOT NULL,
  attempt integer NOT NULL,
  incarnation text NOT NULL,
  payload_digest text NOT NULL,
  acknowledged_through bigint NOT NULL DEFAULT 0,
  offered_through bigint NOT NULL DEFAULT 0,
  polled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, execution_id)
);
CREATE INDEX business_usage_sources_poll ON session.business_usage_sources (polled_at, task_id, execution_id);
CREATE TABLE session.business_usage_events (
  task_id text NOT NULL,
  execution_id text NOT NULL,
  sequence bigint NOT NULL,
  agent_id text NOT NULL,
  occurred_at text NOT NULL,
  capture jsonb NOT NULL,
  PRIMARY KEY (task_id, execution_id, sequence)
);
