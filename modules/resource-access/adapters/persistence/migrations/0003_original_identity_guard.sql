-- 原 0002 及其历史映射保持；此迁移不回填、修复或删除未知历史。
CREATE FUNCTION resource_access.guard_original_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'resource request original identity is immutable' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM resource_access.changes WHERE id=NEW.id AND project_id=NEW.project_id) THEN
    RAISE EXCEPTION 'resource request original identity requires an original request' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_access_original_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON resource_access.deletion_identities FOR EACH ROW EXECUTE FUNCTION resource_access.guard_original_identity();
CREATE TRIGGER resource_access_original_identity_truncate_guard BEFORE TRUNCATE ON resource_access.deletion_identities FOR EACH STATEMENT EXECUTE FUNCTION resource_access.guard_original_identity();

-- 先检查准入与已有原归属，只有实际请求 INSERT 成功后才追加最小映射。
CREATE OR REPLACE FUNCTION resource_access.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[];target text;original_owner text;deletion_id text;internal_delete boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN ids:=array_append(ids,OLD.project_id); END IF;
  IF TG_OP<>'DELETE' THEN ids:=array_append(ids,NEW.project_id); END IF;
  FOR target IN SELECT DISTINCT value FROM unnest(ids) AS value WHERE value IS NOT NULL ORDER BY value LOOP
    IF NOT coalesce(resource_access.actual_shared_admission(target),false) THEN
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('resource-access.project-admission:' || target,0));
    END IF;
    SELECT operation_id INTO deletion_id FROM resource_access.deletion_fences WHERE project_id=target;
    internal_delete:=TG_OP='DELETE' AND deletion_id IS NOT NULL AND deletion_id=current_setting('crewstation.resource_access_deletion',true);
    IF deletion_id IS NOT NULL AND NOT coalesce(internal_delete,false) THEN
      RAISE EXCEPTION 'project resource requests are sealed for deletion' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT project_id INTO original_owner FROM resource_access.deletion_identities WHERE id=NEW.id;
  IF (original_owner IS NOT NULL AND original_owner IS DISTINCT FROM NEW.project_id)
    OR (TG_OP='UPDATE' AND (OLD.id IS DISTINCT FROM NEW.id OR original_owner IS NULL)) THEN
    RAISE EXCEPTION 'resource request identity ownership is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION resource_access.capture_original_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_owner text;
BEGIN
  INSERT INTO resource_access.deletion_identities VALUES(NEW.id,NEW.project_id) ON CONFLICT DO NOTHING;
  SELECT project_id INTO original_owner FROM resource_access.deletion_identities WHERE id=NEW.id;
  IF original_owner IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'resource request identity ownership is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_access_capture_original_identity AFTER INSERT ON resource_access.changes FOR EACH ROW EXECUTE FUNCTION resource_access.capture_original_identity();
