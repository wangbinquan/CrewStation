CREATE TABLE observability.native_captures (
  id text PRIMARY KEY, task_key text NOT NULL, source_id text NOT NULL, turn text NOT NULL,
  lineage_key text NOT NULL, root text, finalized boolean NOT NULL, document jsonb NOT NULL, summary jsonb NOT NULL
);
CREATE INDEX native_capture_task ON observability.native_captures (task_key, id);
CREATE INDEX native_capture_turn ON observability.native_captures (task_key, source_id, turn);
CREATE TABLE observability.native_capture_history (
  task_key text NOT NULL, sequence bigint NOT NULL, capture_id text NOT NULL, document jsonb NOT NULL,
  PRIMARY KEY (task_key, sequence)
);
CREATE INDEX native_capture_boundary ON observability.native_capture_history (task_key, capture_id, sequence);
CREATE TABLE observability.native_steps (
  capture_id text NOT NULL, record_id text NOT NULL, task_key text NOT NULL, native_key text NOT NULL,
  root text NOT NULL, revision bigint NOT NULL, fingerprint text NOT NULL, PRIMARY KEY (capture_id, record_id)
);
CREATE INDEX native_step_owner ON observability.native_steps (task_key, native_key, capture_id);
CREATE TABLE observability.native_baselines (
  capture_id text NOT NULL, ordinal integer NOT NULL, task_key text NOT NULL, native_key text NOT NULL,
  document jsonb NOT NULL, status text NOT NULL, owner_id text, PRIMARY KEY (capture_id, ordinal)
);
CREATE INDEX native_baseline_owner ON observability.native_baselines (task_key, native_key, capture_id);
