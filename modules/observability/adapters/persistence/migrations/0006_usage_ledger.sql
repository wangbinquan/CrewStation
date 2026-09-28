CREATE TABLE observability.usage_heads (
  task_key text PRIMARY KEY, project_id text NOT NULL, task_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0 AND sequence <= 9007199254740991)
);
CREATE TABLE observability.usage_sources (
  task_key text NOT NULL, source_id text NOT NULL, cursor text,
  PRIMARY KEY (task_key, source_id)
);
CREATE TABLE observability.usage_pages (
  task_key text NOT NULL, source_id text NOT NULL, cursor text NOT NULL, fingerprint text NOT NULL,
  PRIMARY KEY (task_key, source_id, cursor)
);
CREATE TABLE observability.usage_events (
  task_key text NOT NULL, source_id text NOT NULL, event_id text NOT NULL, fingerprint text NOT NULL,
  PRIMARY KEY (task_key, source_id, event_id)
);
CREATE TABLE observability.usage_evidence (
  meter_key text NOT NULL, revision bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  fingerprint text NOT NULL, document jsonb NOT NULL, PRIMARY KEY (meter_key, revision)
);
CREATE TABLE observability.usage_projections (
  meter_key text PRIMARY KEY, task_key text NOT NULL, document jsonb NOT NULL
);
CREATE INDEX usage_projection_task ON observability.usage_projections (task_key, meter_key);
CREATE TABLE observability.usage_changes (
  task_key text NOT NULL, sequence bigint NOT NULL CHECK (sequence > 0 AND sequence <= 9007199254740991),
  meter_key text NOT NULL, document jsonb NOT NULL, PRIMARY KEY (task_key, sequence)
);
CREATE INDEX usage_change_meter ON observability.usage_changes (task_key, meter_key, sequence);
