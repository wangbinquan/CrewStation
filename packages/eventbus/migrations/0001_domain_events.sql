CREATE SCHEMA IF NOT EXISTS platform_infra;
CREATE TABLE IF NOT EXISTS platform_infra.domain_events (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  trace_id text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domain_events_topic_idx ON platform_infra.domain_events (topic, id);
CREATE TABLE IF NOT EXISTS platform_infra.event_cursors (
  consumer text PRIMARY KEY,
  last_event_id bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_infra.event_dead_letters (
  consumer text NOT NULL,
  event_id bigint NOT NULL,
  error text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
