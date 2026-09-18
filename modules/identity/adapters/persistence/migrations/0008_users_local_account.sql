-- RFC-005 §3：本地密码账户只有引导管理员这一条来源。password_hash 为空即「无本地口令」，
-- 与「有口令但错」在登录时走同一条恒定时间路径，不泄露账号存在性。
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS git_name text;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON identity.users (username);
