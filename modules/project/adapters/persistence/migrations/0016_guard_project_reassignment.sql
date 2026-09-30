-- 已闭准入的项目内容不能通过改 project_id 搬到另一项目后逃过清理；两侧按相同顺序锁定。
CREATE OR REPLACE FUNCTION project.guard_content_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text; target_ids text[]; target_state text;
BEGIN
  IF TG_OP = 'UPDATE' THEN target_ids := ARRAY[OLD.project_id, NEW.project_id];
  ELSIF TG_OP = 'DELETE' THEN target_ids := ARRAY[OLD.project_id];
  ELSE target_ids := ARRAY[NEW.project_id]; END IF;
  FOR target_id IN SELECT DISTINCT value FROM unnest(target_ids) value ORDER BY value LOOP
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
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
