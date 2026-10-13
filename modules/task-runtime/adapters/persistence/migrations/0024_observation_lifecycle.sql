-- Retain only original lifecycle metadata on a real state/stage change. No render/material/credentials.
CREATE TABLE task_runtime.observation_lifecycle(sequence bigserial PRIMARY KEY,task_id text NOT NULL,project_id text NOT NULL,observed_at timestamptz NOT NULL,document jsonb NOT NULL);
CREATE INDEX observation_lifecycle_task ON task_runtime.observation_lifecycle(task_id,sequence);
CREATE FUNCTION task_runtime.retain_observation_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.native->>'state' IS DISTINCT FROM OLD.native->>'state' OR NEW.startup IS DISTINCT FROM OLD.startup THEN
 INSERT INTO task_runtime.observation_lifecycle(task_id,project_id,observed_at,document) VALUES(NEW.id,NEW.project_id,NEW.updated_at,jsonb_build_object('state',NEW.state,'nativeState',NEW.native->>'state','agentId',NEW.native->>'agentId','startup',NEW.startup));
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER retain_observation_lifecycle AFTER INSERT OR UPDATE ON task_runtime.environments FOR EACH ROW EXECUTE FUNCTION task_runtime.retain_observation_lifecycle();

CREATE TRIGGER runtime_all_content_guard BEFORE INSERT OR UPDATE OR DELETE ON task_runtime.observation_lifecycle FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_all_content();
CREATE TRIGGER runtime_all_content_truncate BEFORE TRUNCATE ON task_runtime.observation_lifecycle FOR EACH STATEMENT EXECUTE FUNCTION task_runtime.reject_work_truncate();
