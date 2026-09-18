-- RFC-005 §5：登录策略单行。bootstrap_completed_at 为空表示引导令牌仍是唯一入口；
-- 它是「引导是否已完成」的唯一事实源——删掉引导令牌的 Secret 不等于退役，重建也不能复活权限。
CREATE TABLE IF NOT EXISTS identity.auth_login_policy (
  id text PRIMARY KEY CHECK (id = 'global'),
  password_login_enabled boolean NOT NULL DEFAULT true,
  bootstrap_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO identity.auth_login_policy (id, password_login_enabled, bootstrap_completed_at)
VALUES ('global', true, NULL)
ON CONFLICT (id) DO NOTHING;
