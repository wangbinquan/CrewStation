CREATE TABLE observability.execution_price_correction_records (
 project_id text NOT NULL,task_id text NOT NULL,task_key text NOT NULL,execution_id text NOT NULL,generation integer NOT NULL,source_id text NOT NULL,record_id text NOT NULL,operation_id text NOT NULL,document jsonb NOT NULL,
 PRIMARY KEY(execution_id,generation,source_id,record_id)
);
CREATE INDEX execution_price_correction_records_project ON observability.execution_price_correction_records(project_id);
