CREATE TABLE IF NOT EXISTS events.producers (
  producer text PRIMARY KEY,
  service_id text NOT NULL,
  project_id text NOT NULL,
  project_slug text NOT NULL,
  service_identity text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS events.event_types (
  event_type text PRIMARY KEY,
  producer text NOT NULL,
  producer_project text NOT NULL,
  schema_ref text
);
CREATE INDEX IF NOT EXISTS event_types_producer_idx ON events.event_types (producer);
CREATE TABLE IF NOT EXISTS events.subscriptions (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  project_id text NOT NULL,
  event_type text NOT NULL,
  handler_path text NOT NULL,
  state text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_service_event_idx ON events.subscriptions (service_id, event_type);
CREATE INDEX IF NOT EXISTS subscriptions_event_type_idx ON events.subscriptions (event_type, state);
CREATE INDEX IF NOT EXISTS subscriptions_project_idx ON events.subscriptions (project_id);
CREATE TABLE IF NOT EXISTS events.inbox (
  id text PRIMARY KEY,
  producer text NOT NULL,
  producer_project text NOT NULL,
  event_type text NOT NULL,
  dedup_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  trace_id text NOT NULL,
  payload jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_dedup_idx ON events.inbox (producer, dedup_key);
CREATE INDEX IF NOT EXISTS inbox_trace_idx ON events.inbox (trace_id);
CREATE TABLE IF NOT EXISTS events.deliveries (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  subscription_id text NOT NULL,
  service_id text NOT NULL,
  project_id text NOT NULL,
  event_type text NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL,
  next_attempt_at timestamptz,
  last_error text,
  trace_id text NOT NULL,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS deliveries_project_idx ON events.deliveries (project_id, state, created_at);
CREATE INDEX IF NOT EXISTS deliveries_event_idx ON events.deliveries (event_id);
CREATE INDEX IF NOT EXISTS deliveries_trace_idx ON events.deliveries (trace_id);
