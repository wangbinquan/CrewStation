-- Coordination leases do not authorize new resources. Closed projects still need original holders to finish,
-- and absent records need the ordinary reconciler to stop their original physical objects.
CREATE FUNCTION resources.guard_project_deletion_lease() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_content jsonb; after_content jsonb; target text; target_ids text[]; deletion_id text; is_retired boolean; resource_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_content := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_content := to_jsonb(NEW); END IF;
  target_ids := ARRAY[resources.content_project(before_content),resources.content_project(after_content)];
  FOR target IN SELECT DISTINCT value FROM unnest(target_ids) value WHERE value IS NOT NULL ORDER BY value LOOP
    IF NOT coalesce(resources.actual_shared_admission(target),false) THEN
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('resources.project-admission:' || target,0));
    END IF;
    SELECT operation_id,retired INTO deletion_id,is_retired FROM resources.deletion_fences WHERE project_id=target;
    IF deletion_id IS NULL OR coalesce(deletion_id=current_setting('crewstation.resources_deletion',true),false) THEN CONTINUE; END IF;
    IF is_retired THEN RAISE EXCEPTION 'project resource lease is retired' USING ERRCODE='55000'; END IF;
    IF TG_OP='DELETE' THEN CONTINUE; END IF;
    IF TG_OP='UPDATE' AND before_content->>'resource_id' IS DISTINCT FROM after_content->>'resource_id' THEN
      RAISE EXCEPTION 'project resource lease identity is sealed' USING ERRCODE='55000';
    END IF;
    resource_key:=after_content->>'resource_id';
    IF EXISTS(SELECT 1 FROM resources.records WHERE id=resource_key AND project_id=target AND desired='absent') THEN CONTINUE; END IF;
    -- A suppressed row returns no lease; the controller waits without creating content after seal.
    IF TG_OP='INSERT' OR before_content->>'holder' IS DISTINCT FROM after_content->>'holder'
      OR (before_content->>'expires_at')::timestamptz <= now() THEN RETURN NULL; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER project_deletion_admission ON resources.leases;
CREATE TRIGGER project_deletion_admission BEFORE INSERT OR UPDATE OR DELETE ON resources.leases
  FOR EACH ROW EXECUTE FUNCTION resources.guard_project_deletion_lease();
