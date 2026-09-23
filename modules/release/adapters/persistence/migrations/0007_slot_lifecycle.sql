-- RFC-021：待命槽的下线、重新部署、推迟与提醒记录；平台统一的自动下线时长（单行）。
CREATE TABLE IF NOT EXISTS release.slot_events (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  kind text NOT NULL,
  release_id text NOT NULL,
  tag text NOT NULL,
  reason text,
  actor_user_id text,
  deadline timestamptz,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS slot_events_service_idx ON release.slot_events (service_id, at DESC);
CREATE TABLE IF NOT EXISTS release.offline_policy (
  id text PRIMARY KEY,
  rollback_retention_hours integer NOT NULL CHECK (rollback_retention_hours >= 1),
  idle_offline_days integer NOT NULL CHECK (idle_offline_days >= 1),
  reminder_lead_hours integer NOT NULL CHECK (reminder_lead_hours >= 1),
  revision integer NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL
);
