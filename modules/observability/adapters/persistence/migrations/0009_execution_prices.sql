CREATE TABLE observability.accepted_execution_prices (
  execution_id text NOT NULL, generation bigint NOT NULL CHECK (generation > 0 AND generation <= 9007199254740991),
  fingerprint text NOT NULL, document jsonb NOT NULL, PRIMARY KEY (execution_id, generation)
);
