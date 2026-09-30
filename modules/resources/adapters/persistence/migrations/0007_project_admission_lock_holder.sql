-- shared 准入锁使用独立池；在途 UOW 仍独立持久提交。
-- 仅当真实 backend 持有本数据库／本项目的 shared 锁时，才允许在排他的 seal 队列前完成已授权写。
CREATE FUNCTION resources.actual_shared_admission(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('crewstation.shared_admission_key',true) = 'resources.project-admission:' || target
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND granted AND mode = 'ShareLock'
      AND pid = coalesce(nullif(current_setting('crewstation.shared_admission_pid',true),''),'0')::integer
      AND database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()) AND objsubid = 1
      AND classid::bigint = ((hashtextextended('resources.project-admission:' || target,0) >> 32) & 4294967295)
      AND objid::bigint = (hashtextextended('resources.project-admission:' || target,0) & 4294967295))
$$;
CREATE OR REPLACE FUNCTION resources.guard_project_deletion_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_content jsonb; after_content jsonb; target text; target_ids text[]; deletion_id text; is_retired boolean; cleanup boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_content := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_content := to_jsonb(NEW); END IF;
  target_ids := ARRAY[resources.content_project(before_content),resources.content_project(after_content)];
  FOR target IN SELECT DISTINCT value FROM unnest(target_ids) value WHERE value IS NOT NULL ORDER BY value LOOP
    IF NOT coalesce(resources.actual_shared_admission(target),false) THEN
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('resources.project-admission:' || target,0));
    END IF;
    SELECT operation_id,retired INTO deletion_id,is_retired FROM resources.deletion_fences WHERE project_id = target;
    cleanup := deletion_id IS NOT NULL AND deletion_id = current_setting('crewstation.resources_deletion',true);
    IF deletion_id IS NOT NULL AND NOT coalesce(cleanup,false) THEN
      IF is_retired OR (TG_OP = 'DELETE' AND TG_TABLE_NAME <> 'children') THEN
        RAISE EXCEPTION 'project resource content is sealed for deletion' USING ERRCODE = '55000';
      END IF;
      IF TG_TABLE_NAME = 'records' THEN
        IF TG_OP = 'INSERT' OR before_content->>'project_id' IS DISTINCT FROM after_content->>'project_id'
          OR before_content->'spec' IS DISTINCT FROM after_content->'spec'
          OR (before_content->>'desired' = 'absent' AND after_content->>'desired' <> 'absent') THEN
          RAISE EXCEPTION 'project resource admission is sealed' USING ERRCODE = '55000';
        END IF;
      ELSIF TG_TABLE_NAME = 'workload_consumers' THEN
        IF TG_OP = 'INSERT' OR before_content->>'resource_id' IS DISTINCT FROM after_content->>'resource_id'
          OR before_content->>'task_id' IS DISTINCT FROM after_content->>'task_id'
          OR before_content->>'namespace' IS DISTINCT FROM after_content->>'namespace'
          OR before_content->>'pod_name' IS DISTINCT FROM after_content->>'pod_name'
          OR before_content->'start_permit' IS DISTINCT FROM after_content->'start_permit'
          OR (before_content->>'admission_closed' = 'true' AND after_content->>'admission_closed' <> 'true') THEN
          RAISE EXCEPTION 'project workload admission is sealed' USING ERRCODE = '55000';
        END IF;
      ELSIF TG_TABLE_NAME = 'task_volume_safety' THEN
        IF coalesce(before_content->'body'->>'provisionIssued','false') <> 'true' AND after_content->'body'->>'provisionIssued' = 'true' THEN
          RAISE EXCEPTION 'project volume provisioning is sealed' USING ERRCODE = '55000';
        END IF;
      ELSIF TG_TABLE_NAME IN ('aliases','project_locks') AND TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'project resource identity is sealed' USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
