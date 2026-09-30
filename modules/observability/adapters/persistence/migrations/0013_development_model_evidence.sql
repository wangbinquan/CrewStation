-- RFC-034: private selected-model evidence follows ordinary usage evidence retention.
-- No second token/price ledger or startup material is stored here.
CREATE TABLE observability.development_model_evidence (
  meter_key text NOT NULL,
  revision bigint NOT NULL,
  fingerprint text NOT NULL,
  document jsonb NOT NULL,
  PRIMARY KEY (meter_key, revision)
);
