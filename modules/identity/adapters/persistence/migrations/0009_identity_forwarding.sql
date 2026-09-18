-- RFC-005 A8／A9：哪些身份字段允许外发给业务。全局一行（scope='global'，project_id 为空），
-- 每个项目至多一行覆盖。字段只影响外发，平台侧 user_identities.profile 始终存全量。
CREATE TABLE IF NOT EXISTS identity.identity_forwarding (
  id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('global', 'project')),
  project_id text,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_forwarding_global_uq ON identity.identity_forwarding ((scope)) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS identity_forwarding_project_uq ON identity.identity_forwarding (project_id) WHERE scope = 'project';
-- 默认转发集与本 RFC 之前的行为一致：显示名与邮箱照旧外发（用户 ID 与身份令牌恒定外发，不在集合里）。
INSERT INTO identity.identity_forwarding (id, scope, project_id, fields)
VALUES ('global', 'global', NULL, '["name","email"]'::jsonb)
ON CONFLICT (id) DO NOTHING;
