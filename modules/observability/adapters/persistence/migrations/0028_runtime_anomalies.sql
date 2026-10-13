CREATE TABLE observability.runtime_anomaly_state(key text PRIMARY KEY,project_id text,task_id text,id text NOT NULL,document jsonb NOT NULL);
CREATE TABLE observability.runtime_anomaly_history(sequence bigserial PRIMARY KEY,id text NOT NULL,project_id text,task_id text,document jsonb NOT NULL);
CREATE INDEX runtime_anomaly_history_project ON observability.runtime_anomaly_history(project_id,id,sequence);
