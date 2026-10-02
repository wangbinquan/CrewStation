CREATE TABLE observability.deletion_fences (
  project_id text PRIMARY KEY, operation_id text NOT NULL, generation integer NOT NULL CHECK(generation>0),
  revision text NOT NULL CHECK(revision~'^[a-f0-9]{64}$'), original jsonb NOT NULL, verified boolean NOT NULL,
  phase_index integer NOT NULL DEFAULT -1 CHECK(phase_index BETWEEN -1 AND 6),
  completed_count integer NOT NULL CHECK(completed_count>=0), completed_digest text CHECK(completed_digest~'^[a-f0-9]{64}$')
);
CREATE TABLE observability.deletion_entities (
  kind text NOT NULL, entity_id text NOT NULL, project_id text NOT NULL, PRIMARY KEY(kind,entity_id)
);
CREATE INDEX observability_deletion_entity_project ON observability.deletion_entities(project_id);

CREATE FUNCTION observability.actual_deletion_admission(project text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND pid=pg_backend_pid() AND mode='ExclusiveLock'
    AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
    AND classid::bigint=((hashtextextended('observability.project:' || project,0)>>32)&4294967295)
    AND objid::bigint=(hashtextextended('observability.project:' || project,0)&4294967295))
$$;
CREATE FUNCTION observability.deletion_permission(project text, operation text, generation integer, phase text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('crewstation.observability_deletion',true)=operation || ':' || generation || ':' || phase
    AND observability.actual_deletion_admission(project)
$$;
CREATE FUNCTION observability.row_projects(content jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) FROM unnest(ARRAY[
    content->>'project_id',content->'document'->>'projectId',content->'document'->'identity'->>'projectId',
    content->'document'->'meter'->'identity'->>'projectId',content->'summary'->'identity'->>'projectId',
    content->'model_evidence'->'identity'->>'projectId']) AS value WHERE value IS NOT NULL AND value<>''
$$;
CREATE FUNCTION observability.row_entities(kind text, content jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(DISTINCT entity),'[]'::jsonb) FROM (SELECT jsonb_build_object('kind',entity_kind,'id',entity_id) AS entity FROM
    (VALUES ('task-key',content->>'task_key'),('task',content->>'task_id'),('meter',content->>'meter_key'),('meter',content->>'valuation_key'),
      ('capture',content->>'capture_id'),('capture',content->>'owner_id'),('execution',content->>'execution_id'),
      ('capture',CASE WHEN kind='native_captures' THEN content->>'id' END),
      ('snapshot',CASE WHEN kind='usage_snapshots' THEN content->>'id' END),('alert',CASE WHEN kind='alerts' THEN content->>'id' END),
      ('task',content->'document'->'identity'->>'taskId'),('execution',content->'document'->'identity'->>'executionId'),
      ('task',content->'document'->'meter'->'identity'->>'taskId'),('execution',content->'document'->'meter'->'identity'->>'executionId'),
      ('task',content->'summary'->'identity'->>'taskId'),('execution',content->'summary'->'identity'->>'executionId'),
      ('task',content->'model_evidence'->'identity'->>'taskId'),('execution',content->'model_evidence'->'identity'->>'executionId')
    ) AS identities(entity_kind,entity_id) WHERE entity_id IS NOT NULL AND entity_id<>'') AS entities
$$;
CREATE FUNCTION observability.related_projects(entities jsonb) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT owner ORDER BY owner),'{}'::text[]) FROM (
    SELECT project_id AS owner FROM observability.deletion_entities WHERE entities @> jsonb_build_array(jsonb_build_object('kind',kind,'id',entity_id))
    UNION SELECT project_id FROM observability.usage_heads WHERE entities @> jsonb_build_array(jsonb_build_object('kind','task-key','id',task_key)) OR entities @> jsonb_build_array(jsonb_build_object('kind','task','id',task_id))
    UNION SELECT unnest(observability.row_projects(to_jsonb(usage_projections))) FROM observability.usage_projections WHERE entities @> jsonb_build_array(jsonb_build_object('kind','meter','id',meter_key))
    UNION SELECT unnest(observability.row_projects(to_jsonb(execution_valuations))) FROM observability.execution_valuations WHERE entities @> jsonb_build_array(jsonb_build_object('kind','meter','id',meter_key))
    UNION SELECT unnest(observability.row_projects(to_jsonb(native_captures))) FROM observability.native_captures WHERE entities @> jsonb_build_array(jsonb_build_object('kind','capture','id',id))
    UNION SELECT unnest(observability.row_projects(to_jsonb(accepted_execution_prices))) FROM observability.accepted_execution_prices WHERE entities @> jsonb_build_array(jsonb_build_object('kind','execution','id',execution_id))
  ) AS owners WHERE owner IS NOT NULL AND owner<>''
$$;
CREATE FUNCTION observability.canonical_project(project text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT project_id FROM observability.deletion_fences WHERE project_id=project OR original->'projectKeys' @> jsonb_build_array(project)),project)
$$;
CREATE FUNCTION observability.admit_project(project text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE canonical text; fence observability.deletion_fences;
BEGIN
  canonical:=observability.canonical_project(project);
  -- A writer never waits behind a seal while holding a task or pricing row lock.
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('observability.project:' || canonical,0)) THEN
    RAISE EXCEPTION 'Observation project admission is closing' USING ERRCODE='55000';
  END IF;
  SELECT * INTO fence FROM observability.deletion_fences WHERE project_id=canonical;
  IF to_jsonb(fence)->>'project_id' IS NOT NULL THEN RAISE EXCEPTION 'Observation project is permanently closed' USING ERRCODE='55000'; END IF;
END $$;

CREATE FUNCTION observability.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE content jsonb; entities jsonb; owners text[]; previous text[]; project text; fence observability.deletion_fences;
BEGIN
  content:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  entities:=observability.row_entities(TG_TABLE_NAME,content);
  SELECT coalesce(array_agg(DISTINCT observability.canonical_project(value) ORDER BY observability.canonical_project(value)),'{}'::text[]) INTO owners
    FROM unnest(observability.row_projects(content) || observability.related_projects(entities)) AS value;
  IF cardinality(owners)<>1 THEN RAISE EXCEPTION 'Observation content requires unambiguous original project ownership' USING ERRCODE='55000'; END IF;
  IF TG_OP='UPDATE' THEN
    SELECT coalesce(array_agg(DISTINCT observability.canonical_project(value)),'{}'::text[]) INTO previous
      FROM unnest(observability.row_projects(to_jsonb(OLD)) || observability.related_projects(observability.row_entities(TG_TABLE_NAME,to_jsonb(OLD)))) AS value;
    IF previous IS DISTINCT FROM owners OR TG_TABLE_NAME='usage_heads' AND (to_jsonb(OLD)->>'task_key' IS DISTINCT FROM content->>'task_key' OR to_jsonb(OLD)->>'project_id' IS DISTINCT FROM content->>'project_id' OR to_jsonb(OLD)->>'task_id' IS DISTINCT FROM content->>'task_id') THEN
      RAISE EXCEPTION 'Observation original project ownership cannot be transferred' USING ERRCODE='55000';
    END IF;
  END IF;
  project:=owners[1]; SELECT * INTO fence FROM observability.deletion_fences WHERE project_id=project;
  IF fence.project_id IS NOT NULL AND TG_OP='DELETE' AND fence.verified AND fence.phase_index=4
    AND coalesce(observability.deletion_permission(project,fence.operation_id,fence.generation,'metadata'),false) THEN RETURN OLD; END IF;
  PERFORM observability.admit_project(project);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION observability.guard_deletion_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' OR split_part(current_setting('crewstation.observability_deletion',true),':',3) IS DISTINCT FROM 'seal'
    OR NOT observability.actual_deletion_admission(NEW.project_id) THEN
    RAISE EXCEPTION 'Observation entity identity must retain an immutable owner tombstone' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION observability.guard_deletion_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text; expected integer;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Observation deletion tombstone cannot be erased' USING ERRCODE='55000'; END IF;
  phase:=split_part(current_setting('crewstation.observability_deletion',true),':',3);
  expected:=array_position(ARRAY['seal','stop','purge','prove','namespace','metadata','verify'],phase)-1;
  IF NOT coalesce(observability.deletion_permission(NEW.project_id,NEW.operation_id,NEW.generation,phase),false)
    OR NEW.original->>'projectId' IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'Observation deletion requires original owner admission' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF phase<>'seal' OR NEW.phase_index<>-1 OR NEW.completed_digest IS NOT NULL THEN RAISE EXCEPTION 'Observation deletion must start at seal' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.operation_id IS DISTINCT FROM NEW.operation_id OR OLD.original IS DISTINCT FROM NEW.original
    OR OLD.generation>NEW.generation OR OLD.completed_digest IS NOT NULL THEN RAISE EXCEPTION 'Observation original deletion identity is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.generation>OLD.generation THEN
    IF phase<>'seal' OR NEW.phase_index<>-1 OR NEW.completed_digest IS NOT NULL THEN RAISE EXCEPTION 'Observation reconfirmation must start at seal' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.revision IS DISTINCT FROM NEW.revision OR OLD.verified IS DISTINCT FROM NEW.verified OR OLD.completed_count<>NEW.completed_count
    OR NOT OLD.verified OR NEW.phase_index<>OLD.phase_index+1 OR NEW.phase_index IS DISTINCT FROM expected
    OR NEW.completed_digest IS NOT NULL AND (phase<>'verify' OR OLD.phase_index<>5) THEN
    RAISE EXCEPTION 'Observation deletion requires its original confirmed predecessor' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_deletion_fence_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.deletion_fences FOR EACH ROW EXECUTE FUNCTION observability.guard_deletion_fence();
CREATE TRIGGER observation_deletion_entity_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.deletion_entities FOR EACH ROW EXECUTE FUNCTION observability.guard_deletion_entity();
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['accepted_execution_prices','alerts','cost_visibility','cost_visibility_receipts','development_model_evidence',
    'execution_valuation_receipts','execution_valuations','native_baselines','native_capture_history','native_captures','native_repairs','native_steps',
    'usage_changes','usage_events','usage_evidence','usage_heads','usage_pages','usage_projections','usage_snapshots','usage_sources'] LOOP
    EXECUTE format('CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.%I FOR EACH ROW EXECUTE FUNCTION observability.guard_content()',name);
  END LOOP;
END $$;
