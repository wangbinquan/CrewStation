-- RFC-004：运行环境、只追加的版本、凭据密文与检查记录。跨模块只存 ID，不建外键。
CREATE TABLE IF NOT EXISTS agent_runtime.configs (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  driver text NOT NULL,
  draft_revision integer NOT NULL,
  active_revision integer,
  enabled boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runtime.revisions (
  config_id text NOT NULL,
  revision integer NOT NULL,
  content jsonb NOT NULL,
  content_hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (config_id, revision)
);
CREATE TABLE IF NOT EXISTS agent_runtime.credentials (
  config_id text NOT NULL,
  name text NOT NULL,
  cipher_text text NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (config_id, name)
);
CREATE TABLE IF NOT EXISTS agent_runtime.checks (
  check_id text PRIMARY KEY,
  config_id text NOT NULL,
  revision integer NOT NULL,
  content_hash text NOT NULL,
  client_request_id text NOT NULL,
  created_by text NOT NULL,
  model text,
  state text NOT NULL,
  context jsonb NOT NULL,
  stages jsonb NOT NULL,
  error text,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS checks_request ON agent_runtime.checks (config_id, created_by, client_request_id);
CREATE INDEX IF NOT EXISTS checks_config_revision ON agent_runtime.checks (config_id, revision, created_at);
