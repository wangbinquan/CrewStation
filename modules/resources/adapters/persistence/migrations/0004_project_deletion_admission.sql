-- 项目与原资源身份的最小墓碑，不保存 spec、凭据、事件或业务材料。
CREATE TABLE resources.deletion_fences (
  project_id text PRIMARY KEY, operation_id text, generation integer NOT NULL DEFAULT 0 CHECK(generation >= 0),
  confirmed_revision text, cluster_revision text, retired boolean NOT NULL DEFAULT false
);
CREATE TABLE resources.deletion_identities (
  project_id text NOT NULL, identity_kind text NOT NULL CHECK(identity_kind IN ('record','task','consumer')), identity_key text NOT NULL,
  PRIMARY KEY(identity_kind,identity_key)
);
CREATE INDEX deletion_identities_project_idx ON resources.deletion_identities(project_id);

CREATE FUNCTION resources.content_project(content jsonb) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE result text; resource_key text; task_key text; consumer_key text;
BEGIN
  IF content->>'project_id' IS NOT NULL THEN RETURN content->>'project_id'; END IF;
  resource_key := coalesce(content->>'resource_id',content->'identity'->>'resourceId');
  task_key := coalesce(content->>'task_id',content->'identity'->'consumer'->>'taskId');
  consumer_key := coalesce(content->>'consumer_id',content->>'id');
  SELECT project_id INTO result FROM resources.records WHERE id = resource_key;
  IF result IS NULL THEN SELECT project_id INTO result FROM resources.deletion_identities WHERE identity_kind = 'record' AND identity_key = resource_key; END IF;
  IF result IS NULL THEN SELECT project_id INTO result FROM resources.records WHERE id = task_key; END IF;
  IF result IS NULL THEN SELECT project_id INTO result FROM resources.deletion_identities WHERE identity_kind = 'task' AND identity_key = task_key; END IF;
  IF result IS NULL THEN SELECT project_id INTO result FROM resources.records WHERE id = (SELECT resource_id FROM resources.workload_consumers WHERE id = consumer_key LIMIT 1); END IF;
  IF result IS NULL THEN SELECT project_id INTO result FROM resources.deletion_identities WHERE identity_kind = 'consumer' AND identity_key = consumer_key; END IF;
  RETURN result;
END $$;

CREATE FUNCTION resources.guard_project_deletion_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_content jsonb; after_content jsonb; target text; target_ids text[]; deletion_id text; is_retired boolean; cleanup boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_content := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_content := to_jsonb(NEW); END IF;
  target_ids := ARRAY[resources.content_project(before_content),resources.content_project(after_content)];
  FOR target IN SELECT DISTINCT value FROM unnest(target_ids) value WHERE value IS NOT NULL ORDER BY value LOOP
    -- 与跨事务物理 apply 共享读锁；seal 取得排他锁后才能签发屏障回执。
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('resources.project-admission:' || target,0));
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
DO $$
DECLARE content_table text;
BEGIN
  FOREACH content_table IN ARRAY ARRAY['records','children','aliases','leases','changes','project_locks','task_volume_safety','task_storage_fences','workload_consumers','workload_stop_proofs','workload_admission_closures','workload_stop_scans'] LOOP
    EXECUTE format('CREATE TRIGGER project_deletion_admission BEFORE INSERT OR UPDATE OR DELETE ON resources.%I FOR EACH ROW EXECUTE FUNCTION resources.guard_project_deletion_content()',content_table);
  END LOOP;
END $$;
