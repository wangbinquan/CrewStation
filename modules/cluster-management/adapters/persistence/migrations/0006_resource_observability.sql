CREATE TABLE cluster_management.metric_observations (
  id text PRIMARY KEY, created_at timestamptz NOT NULL, body jsonb NOT NULL
);
CREATE INDEX metric_observations_created ON cluster_management.metric_observations (created_at DESC);
CREATE TABLE cluster_management.metric_collectors (
  kind text PRIMARY KEY, request_id text NOT NULL, fence bigint NOT NULL DEFAULT 0,
  state text NOT NULL, requested_at timestamptz NOT NULL
);
CREATE TABLE cluster_management.metric_storage (
  id text PRIMARY KEY, updated_at timestamptz NOT NULL, body jsonb NOT NULL
);
CREATE TABLE cluster_management.metric_history (
  id text PRIMARY KEY, last_seen timestamptz NOT NULL, body jsonb NOT NULL
);
CREATE INDEX metric_history_last_seen ON cluster_management.metric_history (last_seen);
