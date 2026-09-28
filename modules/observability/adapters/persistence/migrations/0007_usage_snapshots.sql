CREATE TABLE observability.usage_snapshots (
  id text PRIMARY KEY, task_key text NOT NULL,
  through bigint NOT NULL CHECK (through >= 0 AND through <= 9007199254740991),
  created_at bigint NOT NULL, expires_at bigint NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX usage_snapshot_expiry ON observability.usage_snapshots (expires_at);
