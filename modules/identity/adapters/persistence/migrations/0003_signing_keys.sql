CREATE TABLE IF NOT EXISTS identity.signing_keys (
  name text PRIMARY KEY,
  material text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
