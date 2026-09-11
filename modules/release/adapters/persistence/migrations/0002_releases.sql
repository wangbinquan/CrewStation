CREATE TABLE IF NOT EXISTS release.releases (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  project_id text NOT NULL,
  tag text NOT NULL,
  commit_sha text NOT NULL,
  branch text NOT NULL,
  status text NOT NULL,
  target_slot text NOT NULL,
  image text,
  manifest jsonb,
  config_version integer,
  pipeline jsonb NOT NULL,
  message text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS releases_service_tag_idx ON release.releases (service_id, tag);
CREATE INDEX IF NOT EXISTS releases_service_created_idx ON release.releases (service_id, created_at DESC);
CREATE TABLE IF NOT EXISTS release.service_slots (
  service_id text PRIMARY KEY,
  active text NOT NULL,
  blue jsonb NOT NULL,
  green jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS release.traffic_switches (
  id text PRIMARY KEY,
  service_id text NOT NULL,
  from_slot text NOT NULL,
  to_slot text NOT NULL,
  release_id text NOT NULL,
  actor_user_id text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS traffic_switches_service_idx ON release.traffic_switches (service_id, created_at DESC);
