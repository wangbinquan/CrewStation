CREATE TABLE observability.execution_valuations (
  meter_key text PRIMARY KEY, task_key text NOT NULL, basis_fingerprint text NOT NULL, document jsonb NOT NULL
);
CREATE TABLE observability.execution_valuation_receipts (
  task_key text NOT NULL, request_key text NOT NULL, fingerprint text NOT NULL, document jsonb NOT NULL,
  PRIMARY KEY (task_key, request_key)
);
