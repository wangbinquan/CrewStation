-- A derived lifecycle event inherits the already-admitted environment write.
-- The original 0023 admission, stop grants and metadata deletion fences remain.
ALTER TABLE task_runtime.observation_lifecycle ALTER COLUMN project_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION task_runtime.retain_observation_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.native->>'state' IS DISTINCT FROM OLD.native->>'state' OR NEW.startup IS DISTINCT FROM OLD.startup THEN
 INSERT INTO task_runtime.observation_lifecycle(task_id,project_id,observed_at,document)
 VALUES(NEW.id,CASE WHEN NEW.kind='profile-test' THEN NEW.render->'runtimeValidation'->>'projectId' ELSE NEW.project_id END,
 NEW.updated_at,jsonb_build_object('state',NEW.state,'nativeState',NEW.native->>'state','agentId',NEW.native->>'agentId','startup',NEW.startup));
 END IF; RETURN NEW;
END $$;
CREATE FUNCTION task_runtime.guard_observation_lifecycle_birth() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent task_runtime.environments%ROWTYPE;BEGIN
 SELECT * INTO parent FROM task_runtime.environments WHERE id=NEW.task_id;
 IF NOT FOUND OR pg_trigger_depth()<>2
 OR NEW.project_id IS DISTINCT FROM (CASE WHEN parent.kind='profile-test' THEN parent.render->'runtimeValidation'->>'projectId' ELSE parent.project_id END)
 OR NEW.observed_at IS DISTINCT FROM parent.updated_at
 OR NEW.document IS DISTINCT FROM jsonb_build_object('state',parent.state,'nativeState',parent.native->>'state','agentId',parent.native->>'agentId','startup',parent.startup)
 THEN RAISE EXCEPTION 'Runtime observation lifecycle requires its admitted original environment write';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER runtime_all_content_guard ON task_runtime.observation_lifecycle;
CREATE TRIGGER runtime_observation_lifecycle_birth BEFORE INSERT ON task_runtime.observation_lifecycle FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_observation_lifecycle_birth();
CREATE TRIGGER runtime_all_content_guard BEFORE UPDATE OR DELETE ON task_runtime.observation_lifecycle FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_all_content();
