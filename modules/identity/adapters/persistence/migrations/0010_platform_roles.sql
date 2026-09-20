ALTER TABLE identity.users ADD COLUMN platform_role text NOT NULL DEFAULT 'user'
  CHECK (platform_role IN ('user', 'developer', 'admin'));
ALTER TABLE identity.users ADD COLUMN role_initialized boolean NOT NULL DEFAULT true;
UPDATE identity.users SET platform_role = CASE WHEN is_admin THEN 'admin' ELSE 'user' END,
  role_initialized = is_admin;
