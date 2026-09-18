-- RFC-005 A12：外部身份的唯一键是（Provider, subject）。不同 Provider 之间只做账户不合并，
-- 因此这里既不按邮箱认领，也没有跨 Provider 的合并路径。profile 是平台侧保留的 IdP 档案（A8）。
CREATE TABLE IF NOT EXISTS identity.user_identities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
  provider_id text NOT NULL REFERENCES identity.oidc_providers (id) ON DELETE RESTRICT,
  subject text NOT NULL,
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferred_snapshot text,
  linked_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS user_identities_provider_subject_uq ON identity.user_identities (provider_id, subject);
CREATE INDEX IF NOT EXISTS user_identities_user_idx ON identity.user_identities (user_id);
