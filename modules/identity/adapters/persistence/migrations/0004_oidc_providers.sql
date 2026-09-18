-- RFC-005：管理员维护的 OIDC／OAuth 2.0 身份提供方。client_secret 以 AES-256-GCM 封存（packages/secretbox）。
CREATE TABLE IF NOT EXISTS identity.oidc_providers (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  issuer_url text NOT NULL,
  client_id text NOT NULL,
  client_secret_enc text NOT NULL,
  scopes text NOT NULL DEFAULT 'openid profile email',
  provisioning text NOT NULL DEFAULT 'allowlist' CHECK (provisioning IN ('auto', 'allowlist')),
  allowed_email_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon_url text,
  authorization_endpoint text,
  token_endpoint text,
  userinfo_endpoint text,
  jwks_uri text,
  userinfo_request_style text NOT NULL DEFAULT 'get_bearer' CHECK (userinfo_request_style IN ('get_bearer', 'post_json')),
  trust_email_verified boolean NOT NULL DEFAULT false,
  username_claim text,
  git_name_claim text,
  email_claim text,
  subject_claim text,
  claim_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oidc_providers_enabled_idx ON identity.oidc_providers (enabled);
