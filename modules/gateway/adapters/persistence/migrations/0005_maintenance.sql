-- RFC-021：正式版本维护（每个服务最多一行，行存在即在维护中）与维护记录（进入、调整、退出）。
CREATE TABLE IF NOT EXISTS gateway.service_maintenance (
  service_id text PRIMARY KEY,
  project_id text NOT NULL,
  body jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS gateway.maintenance_events (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  kind text NOT NULL,
  actor_user_id text NOT NULL,
  at timestamptz NOT NULL,
  body jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS maintenance_events_service_idx ON gateway.maintenance_events (service_id, at DESC);
