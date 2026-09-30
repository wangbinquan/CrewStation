-- 不与 project.projects 建级联关系：根记录消失后仍能读取最小删除结果。
ALTER TABLE project.projects ADD COLUMN lifecycle_revision bigint NOT NULL DEFAULT 0 CHECK (lifecycle_revision >= 0);
CREATE TABLE project.deletion_plans (
  id text PRIMARY KEY, project_id text NOT NULL, body jsonb NOT NULL,
  requested_by text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX deletion_plans_project_idx ON project.deletion_plans(project_id);
CREATE TABLE project.deletion_operations (
  id text PRIMARY KEY, project_id text NOT NULL UNIQUE, plan_id text NOT NULL,
  request_key text NOT NULL UNIQUE, requested_by text NOT NULL, body jsonb NOT NULL,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  lease_owner text, lease_until timestamptz,
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);
CREATE INDEX deletion_operations_pending_idx ON project.deletion_operations(lease_until, id)
  WHERE body->>'state' <> 'succeeded';

-- 同一毫秒内的修改也必须使确认材料失效；普通状态写入不能把 deleting 复活。
CREATE FUNCTION project.guard_lifecycle_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'deleting' AND NEW.state <> 'deleting' THEN
    RAISE EXCEPTION 'project is deleting' USING ERRCODE = '55000';
  END IF;
  NEW.lifecycle_revision := OLD.lifecycle_revision + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER project_lifecycle_revision BEFORE UPDATE ON project.projects
  FOR EACH ROW EXECUTE FUNCTION project.guard_lifecycle_revision();

-- 本 schema 的已开始写入同样在根记录锁下闭准入。只允许原清理操作销毁内容。
CREATE FUNCTION project.guard_content_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text; target_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD.project_id; ELSE target_id := NEW.project_id; END IF;
  SELECT state INTO target_state FROM project.projects WHERE id = target_id FOR UPDATE;
  IF target_state IS NULL THEN RAISE EXCEPTION 'project is missing' USING ERRCODE = '23503'; END IF;
  IF target_state = 'deleting' THEN
    IF TG_OP <> 'DELETE' OR NOT EXISTS (
      SELECT 1 FROM project.deletion_operations WHERE project_id = target_id
        AND id = current_setting('crewstation.project_deletion', true)
        AND body->>'state' = 'running' AND lease_until > clock_timestamp()
    ) THEN RAISE EXCEPTION 'project is deleting' USING ERRCODE = '55000'; END IF;
  ELSE
    UPDATE project.projects SET lifecycle_revision = lifecycle_revision + 1 WHERE id = target_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$
DECLARE content_table text;
BEGIN
  FOREACH content_table IN ARRAY ARRAY['services', 'memberships', 'task_quotas', 'app_listings', 'app_access_requests', 'app_icons', 'service_plan_policies', 'namespace_quotas', 'resource_policy_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER project_content_fence BEFORE INSERT OR UPDATE OR DELETE ON project.%I FOR EACH ROW EXECUTE FUNCTION project.guard_content_write()', content_table);
  END LOOP;
END $$;
