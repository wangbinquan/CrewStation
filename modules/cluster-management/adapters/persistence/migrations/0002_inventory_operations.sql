CREATE TABLE cluster_management.snapshots (id text PRIMARY KEY, created_at timestamptz NOT NULL, body jsonb NOT NULL);
CREATE INDEX snapshots_created ON cluster_management.snapshots (created_at DESC);
CREATE TABLE cluster_management.inspections (id text PRIMARY KEY, actor_id text NOT NULL, created_at timestamptz NOT NULL, body jsonb NOT NULL);
CREATE TABLE cluster_management.operations (id text PRIMARY KEY, actor_id text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL, fence bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL, body jsonb NOT NULL);
CREATE UNIQUE INDEX operations_actor_key ON cluster_management.operations (actor_id, idempotency_key);
CREATE INDEX operations_created ON cluster_management.operations (created_at DESC);
CREATE TABLE cluster_management.refreshes (id text PRIMARY KEY, request_id text NOT NULL, requested_at timestamptz NOT NULL, state text NOT NULL);
