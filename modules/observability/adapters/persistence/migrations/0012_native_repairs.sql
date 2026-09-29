ALTER TABLE observability.native_steps ADD COLUMN model_evidence jsonb;
CREATE TABLE observability.native_repairs (
  meter_key text PRIMARY KEY, task_key text NOT NULL, native_key text NOT NULL,
  valuation_key text NOT NULL, active boolean NOT NULL, document jsonb NOT NULL
);
CREATE INDEX native_repair_key ON observability.native_repairs (task_key, native_key);
