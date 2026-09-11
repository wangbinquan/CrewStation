CREATE TABLE IF NOT EXISTS identity.users (
  id text PRIMARY KEY,
  external_id text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS users_email_idx ON identity.users (lower(email));
