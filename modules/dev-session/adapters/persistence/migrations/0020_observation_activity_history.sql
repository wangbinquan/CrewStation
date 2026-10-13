-- Original activity metadata is independent of the workbench's short activity list.
CREATE TABLE dev_session.observation_activity_history(task_id text NOT NULL,source_task_id text NOT NULL,source_seq bigint NOT NULL,agent_id text NOT NULL,event_id text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(source_task_id,source_seq));
CREATE INDEX observation_activity_agent ON dev_session.observation_activity_history(task_id,agent_id,source_task_id,source_seq);

CREATE TRIGGER development_all_content_guard BEFORE INSERT OR UPDATE OR DELETE ON dev_session.observation_activity_history FOR EACH ROW EXECUTE FUNCTION dev_session.guard_all_content();
CREATE TRIGGER development_all_content_truncate BEFORE TRUNCATE ON dev_session.observation_activity_history FOR EACH STATEMENT EXECUTE FUNCTION dev_session.reject_work_truncate();
