CREATE TABLE agent_runtime.deletion_fences(project_id text PRIMARY KEY,operation_id text,generation integer NOT NULL DEFAULT 0,confirmed_revision text,scope_verified boolean NOT NULL DEFAULT false);
CREATE TABLE agent_runtime.deletion_identities(operation_id text PRIMARY KEY,project_id text NOT NULL);
INSERT INTO agent_runtime.deletion_identities SELECT operation_id,project_id FROM agent_runtime.allocation_receipts;

-- 本模块项目写入没有外部副作用；事务共享锁与 seal 排他锁覆盖实际数据库提交。
CREATE FUNCTION agent_runtime.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;original_target text;deletion_id text;verified boolean;
BEGIN
  IF TG_OP='DELETE' THEN target:=OLD.project_id; ELSE target:=NEW.project_id; END IF;
  IF TG_OP='UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR
    (TG_TABLE_NAME='allocation_receipts' AND to_jsonb(NEW)->>'operation_id' IS DISTINCT FROM to_jsonb(OLD)->>'operation_id')) THEN
    RAISE EXCEPTION 'original compute allocation ownership is immutable' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('agent-runtime.project-admission:' || target,0));
  SELECT operation_id,scope_verified INTO deletion_id,verified FROM agent_runtime.deletion_fences WHERE project_id=target;
  IF deletion_id IS NOT NULL AND NOT (TG_OP='DELETE' AND verified AND deletion_id IS NOT DISTINCT FROM current_setting('crewstation.compute_deletion',true)) THEN
    RAISE EXCEPTION 'project compute is sealed for deletion' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='allocation_receipts' AND TG_OP<>'DELETE' THEN
    INSERT INTO agent_runtime.deletion_identities VALUES(NEW.operation_id,target) ON CONFLICT DO NOTHING;
    SELECT project_id INTO original_target FROM agent_runtime.deletion_identities WHERE operation_id=NEW.operation_id;
    IF original_target IS DISTINCT FROM target THEN RAISE EXCEPTION 'original allocation identity cannot be reassigned' USING ERRCODE='55000'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER compute_policy_deletion_fence BEFORE INSERT OR UPDATE OR DELETE ON agent_runtime.project_compute_policies FOR EACH ROW EXECUTE FUNCTION agent_runtime.guard_project_content();
CREATE TRIGGER compute_receipt_deletion_fence BEFORE INSERT OR UPDATE OR DELETE ON agent_runtime.allocation_receipts FOR EACH ROW EXECUTE FUNCTION agent_runtime.guard_project_content();
