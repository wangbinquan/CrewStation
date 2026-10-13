CREATE TABLE observability.usage_model_evidence(meter_key text NOT NULL,revision bigint NOT NULL,project_id text NOT NULL,task_id text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(meter_key,revision));
CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.usage_model_evidence FOR EACH ROW EXECUTE FUNCTION observability.guard_content();

CREATE TRIGGER incremental_runtime_task_change AFTER INSERT OR UPDATE OR DELETE ON observability.usage_model_evidence FOR EACH ROW EXECUTE FUNCTION observability.original_runtime_task_change();
