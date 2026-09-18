-- RFC-006：运行环境并入算力档位（断代，C8：不迁移旧运行环境与旧档位）。
DROP TABLE IF EXISTS agent_runtime.checks;
DROP TABLE IF EXISTS agent_runtime.credentials;
DROP TABLE IF EXISTS agent_runtime.revisions;
DROP TABLE IF EXISTS agent_runtime.configs;

CREATE TABLE IF NOT EXISTS agent_runtime.profiles (
  name text PRIMARY KEY,
  protocol text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  current_revision integer NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL
);
-- 全平台至多一个默认档位。
CREATE UNIQUE INDEX IF NOT EXISTS profiles_single_default ON agent_runtime.profiles (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS agent_runtime.profile_revisions (
  profile text NOT NULL,
  revision integer NOT NULL,
  content jsonb NOT NULL,
  image_digest text NOT NULL,
  content_hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (profile, revision)
);

CREATE TABLE IF NOT EXISTS agent_runtime.profile_credentials (
  profile text NOT NULL,
  name text NOT NULL,
  cipher_text text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (profile, name)
);

CREATE TABLE IF NOT EXISTS agent_runtime.profile_tests (
  test_id text PRIMARY KEY,
  profile text NOT NULL,
  revision integer NOT NULL,
  content_hash text NOT NULL,
  trigger text NOT NULL,
  client_request_id text,
  created_by text NOT NULL,
  state text NOT NULL,
  outcome text,
  context jsonb NOT NULL,
  stages jsonb NOT NULL,
  error text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS profile_tests_request ON agent_runtime.profile_tests (profile, created_by, client_request_id);
CREATE INDEX IF NOT EXISTS profile_tests_revision ON agent_runtime.profile_tests (profile, revision, created_at);
