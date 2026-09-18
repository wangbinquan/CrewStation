-- RFC-005 §4：PKCE／state／nonce 落库而不是进程内 Map——控制面 HA 是 v1 要求，多副本下进程内 state 必坏。
-- 消费是一条原子 UPDATE（consumed_at IS NULL AND expires_at > now()），因此 state 天然一次性。
CREATE TABLE IF NOT EXISTS identity.oidc_flows (
  state text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES identity.oidc_providers (id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_verifier text NOT NULL,
  nonce text NOT NULL,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS oidc_flows_expires_idx ON identity.oidc_flows (expires_at);
