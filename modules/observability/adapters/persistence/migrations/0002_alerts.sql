CREATE TABLE IF NOT EXISTS observability.alerts (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  type text NOT NULL,
  key text NOT NULL,
  state text NOT NULL,
  detail text NOT NULL,
  fired_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS alerts_project_state_idx ON observability.alerts (project_id, state, fired_at DESC);
CREATE TABLE IF NOT EXISTS observability.alert_subscriptions (
  project_id text NOT NULL,
  user_id text NOT NULL,
  channel text NOT NULL,
  target text,
  PRIMARY KEY (project_id, user_id)
);
