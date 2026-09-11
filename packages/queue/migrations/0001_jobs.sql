CREATE SCHEMA IF NOT EXISTS platform_infra;
CREATE TABLE IF NOT EXISTS platform_infra.jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending',
  run_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_owner text,
  fencing_token bigint NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  last_error text,
  dedup_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedup_idx ON platform_infra.jobs (kind, dedup_key)
  WHERE dedup_key IS NOT NULL AND state IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON platform_infra.jobs (kind, state, run_at);
