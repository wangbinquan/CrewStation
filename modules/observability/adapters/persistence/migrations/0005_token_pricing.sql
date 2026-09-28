CREATE TABLE observability.token_price_heads (
  profile_id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision >= 0)
);
CREATE TABLE observability.token_prices (
  profile_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  id text NOT NULL,
  request_key text NOT NULL,
  fingerprint text NOT NULL,
  profile_revision integer NOT NULL,
  protocol text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  condition text,
  effective_from text NOT NULL,
  document jsonb NOT NULL,
  PRIMARY KEY (profile_id, revision)
);
CREATE UNIQUE INDEX token_price_request_key ON observability.token_prices (profile_id, request_key);
CREATE UNIQUE INDEX token_price_id ON observability.token_prices (id);
CREATE INDEX token_price_model_lookup ON observability.token_prices (profile_id, profile_revision, protocol, provider, model, revision DESC);
