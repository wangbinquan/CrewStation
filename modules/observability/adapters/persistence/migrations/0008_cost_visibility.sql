CREATE TABLE observability.cost_visibility (
  project_id text PRIMARY KEY, revision bigint NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991), document jsonb NOT NULL
);
CREATE TABLE observability.cost_visibility_receipts (
  project_id text NOT NULL, request_key text NOT NULL, fingerprint text NOT NULL, document jsonb NOT NULL,
  PRIMARY KEY (project_id, request_key)
);
ALTER TABLE observability.usage_snapshots ADD COLUMN visibility_revision bigint NOT NULL DEFAULT 0 CHECK (visibility_revision >= 0 AND visibility_revision <= 9007199254740991);
