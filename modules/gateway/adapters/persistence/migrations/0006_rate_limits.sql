-- RFC-025 T10：网关限流策略——平台默认一行（scope = 'platform'），项目覆盖每个项目最多一行（scope = 项目 ID）。
CREATE TABLE IF NOT EXISTS gateway.rate_limits (
  scope text PRIMARY KEY,
  body jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);
