CREATE TABLE cluster_management.deletion_fences(
  project_id text PRIMARY KEY,operation_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),revision text NOT NULL CHECK(revision~'^[a-f0-9]{64}$'),
  original jsonb NOT NULL,scope_verified boolean NOT NULL DEFAULT false,stopped boolean NOT NULL DEFAULT false,purged boolean NOT NULL DEFAULT false,
  proved boolean NOT NULL DEFAULT false,metadata_purged boolean NOT NULL DEFAULT false,completed_digest text CHECK(completed_digest~'^[a-f0-9]{64}$'),completed_count integer NOT NULL DEFAULT 0 CHECK(completed_count>=0)
);
CREATE TABLE cluster_management.deletion_work(
  id text PRIMARY KEY,project_id text NOT NULL,operation_id text NOT NULL,backend_pid integer NOT NULL CHECK(backend_pid>0),callback_pid integer NOT NULL CHECK(callback_pid>0),
  callback_started_at timestamptz NOT NULL,process jsonb,state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','exited')),
  exit_digest text CHECK(exit_digest~'^[a-f0-9]{64}$'),recovery_digest text CHECK(recovery_digest~'^[a-f0-9]{64}$')
);
-- Old nonterminal operations have no actual process birth or callback exit proof. Do not invent either on upgrade.
CREATE TABLE cluster_management.deletion_legacy_operations(operation_id text PRIMARY KEY);
INSERT INTO cluster_management.deletion_legacy_operations SELECT id FROM cluster_management.operations WHERE body->>'phase' NOT IN ('succeeded','failed');
CREATE FUNCTION cluster_management.guard_legacy_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Original legacy callback origin cannot be rewritten or erased' USING ERRCODE='55000';
END $$;
CREATE TRIGGER cluster_legacy_operation_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.deletion_legacy_operations FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_legacy_operation();

CREATE FUNCTION cluster_management.actual_admission(target text, shared boolean) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND pid=pg_backend_pid() AND mode=CASE WHEN shared THEN 'ShareLock' ELSE 'ExclusiveLock' END
    AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
    AND classid::bigint=((hashtextextended(target,0)>>32)&4294967295) AND objid::bigint=(hashtextextended(target,0)&4294967295))
$$;
CREATE FUNCTION cluster_management.owner_permission(target text, operation text, generation integer, phase text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('crewstation.cluster_deletion_owner',true)=operation || ':' || generation || ':' || phase
    AND cluster_management.actual_admission('cluster-management.project-admission:' || target,false)
$$;
CREATE FUNCTION cluster_management.guard_deletion_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cluster deletion identity must retain a minimal tombstone' USING ERRCODE='55000'; END IF;
  phase:=split_part(current_setting('crewstation.cluster_deletion_owner',true),':',3);
  IF NOT coalesce(cluster_management.owner_permission(NEW.project_id,NEW.operation_id,NEW.generation,phase),false)
    OR NEW.original->>'projectId' IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'Cluster deletion requires original owner admission' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    IF phase<>'seal' OR NEW.stopped OR NEW.purged OR NEW.proved OR NEW.metadata_purged OR NEW.completed_digest IS NOT NULL OR NEW.completed_count<>0 THEN
      RAISE EXCEPTION 'Cluster deletion must start at seal' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.operation_id IS DISTINCT FROM NEW.operation_id OR OLD.original IS DISTINCT FROM NEW.original
    OR OLD.generation>NEW.generation OR OLD.completed_digest IS NOT NULL OR OLD.generation=NEW.generation AND OLD.revision IS DISTINCT FROM NEW.revision
    OR OLD.scope_verified AND NOT NEW.scope_verified AND (OLD.generation=NEW.generation OR phase<>'seal') OR OLD.stopped AND NOT NEW.stopped OR OLD.purged AND NOT NEW.purged OR OLD.proved AND NOT NEW.proved OR OLD.metadata_purged AND NOT NEW.metadata_purged THEN
    RAISE EXCEPTION 'Cluster original deletion scope and proved stages are immutable' USING ERRCODE='55000'; END IF;
  IF (OLD.generation<>NEW.generation OR OLD.revision<>NEW.revision OR OLD.scope_verified<>NEW.scope_verified) AND phase<>'seal'
    OR NOT OLD.stopped AND NEW.stopped AND (phase<>'stop' OR NOT OLD.scope_verified OR EXISTS(SELECT 1 FROM cluster_management.deletion_work WHERE project_id=NEW.project_id AND (state<>'exited' OR exit_digest IS NULL)))
    OR NOT OLD.purged AND NEW.purged AND (phase<>'purge' OR NOT OLD.stopped)
    OR NOT OLD.proved AND NEW.proved AND (phase<>'prove' OR NOT OLD.purged)
    OR NOT OLD.metadata_purged AND NEW.metadata_purged AND (phase<>'metadata' OR NOT OLD.proved)
    OR OLD.metadata_purged AND OLD.completed_count<>NEW.completed_count
    OR OLD.completed_count<>NEW.completed_count AND phase<>'metadata'
    OR NEW.completed_digest IS NOT NULL AND (phase<>'verify' OR NOT OLD.metadata_purged) THEN
    RAISE EXCEPTION 'Cluster deletion stage requires original predecessor proof' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cluster_deletion_fence_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.deletion_fences FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_deletion_fence();

CREATE FUNCTION cluster_management.guard_callback() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fence cluster_management.deletion_fences;protected boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT * INTO fence FROM cluster_management.deletion_fences WHERE project_id=OLD.project_id;
    IF OLD.state<>'exited' OR OLD.exit_digest IS NULL OR NOT fence.proved OR NOT coalesce(cluster_management.owner_permission(fence.project_id,fence.operation_id,fence.generation,'metadata'),false) THEN
      RAISE EXCEPTION 'Cluster callback needs actual exit and verified cleanup' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock' AND pid=NEW.backend_pid
      AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
      AND classid::bigint=((hashtextextended('cluster-management.project-admission:' || NEW.project_id,0)>>32)&4294967295)
      AND objid::bigint=(hashtextextended('cluster-management.project-admission:' || NEW.project_id,0)&4294967295)) INTO protected;
    IF NOT protected OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true)
      OR current_setting('crewstation.shared_admission_key',true) IS DISTINCT FROM 'cluster-management.project-admission:' || NEW.project_id
      OR NEW.state<>'running' OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
      OR EXISTS(SELECT 1 FROM cluster_management.deletion_fences WHERE project_id=NEW.project_id)
      OR NOT EXISTS(SELECT 1 FROM cluster_management.operations WHERE id=NEW.operation_id AND body->'target'->'ownership'->>'projectId'=NEW.project_id) THEN
      RAISE EXCEPTION 'Cluster callback needs its original live admission and operation' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.operation_id IS DISTINCT FROM NEW.operation_id
    OR OLD.backend_pid IS DISTINCT FROM NEW.backend_pid OR OLD.callback_pid IS DISTINCT FROM NEW.callback_pid OR OLD.callback_started_at IS DISTINCT FROM NEW.callback_started_at OR OLD.process IS DISTINCT FROM NEW.process
    OR OLD.state<>'running' OR NEW.state<>'exited' OR NEW.exit_digest IS NULL
    OR current_setting('crewstation.cluster_callback_exit',true) IS DISTINCT FROM OLD.id || ':' || OLD.backend_pid THEN
    RAISE EXCEPTION 'Cluster callback identity or actual exit is invalid' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cluster_callback_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.deletion_work FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_callback();

CREATE FUNCTION cluster_management.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fence cluster_management.deletion_fences;content jsonb;resource jsonb;resource_uid text;key text;scope jsonb;uids jsonb;other_namespace boolean;foreign_uid boolean;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('cluster-management.project-content',0));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  FOR fence IN SELECT * FROM cluster_management.deletion_fences LOOP
    scope:=fence.original;
    uids:=coalesce(scope->'resources','[]'::jsonb);
    FOREACH content IN ARRAY ARRAY[to_jsonb(NEW)->'body',to_jsonb(NEW)->'legacy_body'] LOOP
      IF content IS NULL THEN CONTINUE; END IF;
      FOR key IN SELECT jsonb_array_elements_text(coalesce(scope->'projectKeys',jsonb_build_array(fence.project_id))) LOOP
        IF jsonb_path_exists(content,'$.**.projectId ? (@ == $id)',jsonb_build_object('id',key))
          OR content->'capacity'->'projects' ? key THEN RAISE EXCEPTION 'Sealed cluster project content cannot be restored' USING ERRCODE='55000'; END IF;
      END LOOP;
      other_namespace:=EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'facts'->'projects','[]'::jsonb)) fact
        WHERE fact->>'namespace'=scope->>'namespace' AND NOT coalesce(scope->'projectKeys',jsonb_build_array(fence.project_id)) ? (fact->>'projectId'));
      IF NOT other_namespace AND (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'sources','[]'::jsonb)) source WHERE source->>'namespace'=scope->>'namespace')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'facts'->'retained','[]'::jsonb)) reference WHERE reference->>'namespace'=scope->>'namespace')) THEN
        RAISE EXCEPTION 'Sealed cluster namespace details cannot be restored' USING ERRCODE='55000'; END IF;
      FOR resource IN SELECT jsonb_array_elements(coalesce(content->'resources','[]'::jsonb) || jsonb_build_array(content->'target',content->'after')) LOOP
        IF resource IS NULL OR resource='null'::jsonb THEN CONTINUE; END IF;
        IF resource->'ownership'->>'scope'='unresolved' AND EXISTS(SELECT 1 FROM jsonb_array_elements(uids) identity WHERE identity->>'id'=resource->>'resourceId' AND identity->>'uid'=resource->>'uid')
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(resource->'owners','[]'::jsonb)) owner JOIN jsonb_array_elements(uids) identity ON identity->>'uid'=owner->>'uid'
            WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'resources','[]'::jsonb)) other WHERE other->>'uid'=identity->>'uid' AND other->'ownership'->>'scope' IN ('project','system')))
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(resource->'references','[]'::jsonb)) reference JOIN jsonb_array_elements(uids) identity ON identity->>'id'=reference
            WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'resources','[]'::jsonb)) other WHERE other->>'uid'=identity->>'uid' AND other->'ownership'->>'scope' IN ('project','system')))
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(resource->'references','[]'::jsonb)) reference
            WHERE coalesce(scope->'referenceHashes','[]'::jsonb) ? encode(sha256(convert_to(to_jsonb(reference)::text,'UTF8')),'hex')
              AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'resources','[]'::jsonb)) other WHERE other->'ownership'->>'scope' IN ('project','system')
                AND other->>'namespace' || '/' || (other->>'kind') || '/' || (other->>'name')=reference)) THEN
          RAISE EXCEPTION 'Sealed original cluster resource references cannot be restored' USING ERRCODE='55000'; END IF;
      END LOOP;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'related','[]'::jsonb)) related JOIN jsonb_array_elements(uids) identity ON identity->>'uid'=related->>'uid')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'facts'->'releases','[]'::jsonb)) release WHERE coalesce(scope->'serviceKeys','[]'::jsonb) ? (release->>'serviceId')) THEN
        RAISE EXCEPTION 'Sealed project related details cannot be restored' USING ERRCODE='55000'; END IF;
      FOR resource_uid IN SELECT DISTINCT identity->>'uid' AS uid FROM jsonb_array_elements(uids) identity LOOP
        foreign_uid:=EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'usages','[]'::jsonb) || coalesce(content->'identities','[]'::jsonb)) usage WHERE usage->>'uid'=resource_uid
          AND NOT coalesce((usage->>'deleted')::boolean,false) AND (usage->>'scope'='system' OR usage->>'scope'='project' AND usage->>'projectId' IS NOT NULL
            AND NOT coalesce(scope->'projectKeys',jsonb_build_array(fence.project_id)) ? (usage->>'projectId')));
        IF NOT foreign_uid AND (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'usages','[]'::jsonb) || coalesce(content->'identities','[]'::jsonb) || jsonb_build_array(content)) usage
          JOIN jsonb_array_elements(uids) identity ON identity->>'uid'=usage->>'uid' AND identity->>'id'=usage->>'resourceId' WHERE usage->>'scope'='unresolved')
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'nodes','[]'::jsonb)) node CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(node->'managedPodIds','[]'::jsonb)) reference
            JOIN jsonb_array_elements(uids) identity ON identity->>'id'=reference WHERE identity->>'uid'=resource_uid)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'nodes','[]'::jsonb)) node CROSS JOIN LATERAL jsonb_array_elements(coalesce(node->'managedPods','[]'::jsonb)) reference
            JOIN jsonb_array_elements(uids) identity ON identity->>'id'=reference->>'resourceId' WHERE identity->>'uid'=resource_uid)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'usages','[]'::jsonb)) usage CROSS JOIN LATERAL jsonb_array_elements(coalesce(usage->'storage'->'mounts','[]'::jsonb)) mount
            JOIN jsonb_array_elements(uids) identity ON identity->>'id'=mount->>'resourceId' WHERE identity->>'uid'=resource_uid)) THEN
          RAISE EXCEPTION 'Sealed original project metric identities cannot be restored' USING ERRCODE='55000'; END IF;
        IF NOT foreign_uid AND (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(content->'storageTargets','[]'::jsonb)) target WHERE target->>'uid'=resource_uid)
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(content->'counters','{}'::jsonb)) counter WHERE resource_uid=ANY(string_to_array(counter,'/')))) THEN
          RAISE EXCEPTION 'Sealed project metric details cannot be restored' USING ERRCODE='55000'; END IF;
        IF TG_TABLE_NAME='metric_storage' AND EXISTS(SELECT 1 FROM jsonb_array_elements(content) sample WHERE sample->>'uid'=resource_uid)
          AND NOT EXISTS(SELECT 1 FROM cluster_management.metric_history history WHERE history.body->>'uid'=resource_uid AND NOT coalesce((history.body->>'deleted')::boolean,false)
            AND (history.body->>'scope'='system' OR history.body->>'scope'='project' AND history.body->>'projectId' IS NOT NULL AND NOT coalesce(scope->'projectKeys',jsonb_build_array(fence.project_id)) ? (history.body->>'projectId')))
          AND NOT EXISTS(SELECT 1 FROM cluster_management.metric_observations observation CROSS JOIN LATERAL jsonb_array_elements(observation.body->'usages') usage
            WHERE observation.id=(SELECT id FROM cluster_management.metric_observations ORDER BY created_at DESC LIMIT 1) AND usage->>'uid'=resource_uid
              AND (usage->>'scope'='system' OR usage->>'scope'='project' AND usage->>'projectId' IS NOT NULL AND NOT coalesce(scope->'projectKeys',jsonb_build_array(fence.project_id)) ? (usage->>'projectId'))) THEN
          RAISE EXCEPTION 'Sealed project storage samples cannot be restored' USING ERRCODE='55000'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER cluster_snapshot_content_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.snapshots FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_project_content();
CREATE TRIGGER cluster_inspection_content_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.inspections FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_project_content();
CREATE TRIGGER cluster_operation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.operations FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_project_content();
CREATE TRIGGER cluster_metric_content_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.metric_observations FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_project_content();
CREATE TRIGGER cluster_metric_history_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.metric_history FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_project_content();
CREATE TRIGGER cluster_metric_storage_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.metric_storage FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_project_content();
