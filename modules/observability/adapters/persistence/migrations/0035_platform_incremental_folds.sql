CREATE TABLE observability.platform_usage_record_folds(key text PRIMARY KEY,test_id text NOT NULL,document jsonb NOT NULL);
CREATE TABLE observability.platform_usage_fold_totals(test_id text PRIMARY KEY,document jsonb NOT NULL,gap_counts jsonb NOT NULL,fast boolean NOT NULL);
CREATE TABLE observability.platform_usage_proofs(key text NOT NULL,turn text NOT NULL,test_id text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(key,turn));
CREATE TABLE observability.platform_usage_observed_executions(key text PRIMARY KEY,test_id text NOT NULL);

ALTER TABLE observability.runtime_occurrence_task_hours ADD COLUMN gap_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
