-- Closed admission persists beyond all recoverable development content. No historical migration is rewritten.
CREATE TABLE dev_session.content_origins(kind text NOT NULL,key text NOT NULL,id text NOT NULL,project_id text NOT NULL,identity text NOT NULL,PRIMARY KEY(kind,key));
CREATE TABLE dev_session.project_deletions(project_id text PRIMARY KEY,operation_id text NOT NULL,generation integer NOT NULL,revision text NOT NULL,
 body jsonb NOT NULL,phases jsonb NOT NULL DEFAULT '{}'::jsonb,verified boolean NOT NULL);
CREATE OR REPLACE FUNCTION dev_session.work_locked(project text,lock_mode text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=backend AND granted AND mode=lock_mode
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND classid=((hashtextextended('dev-session.project-admission:'||project,0)>>32)&4294967295)::oid
 AND objid=(hashtextextended('dev-session.project-admission:'||project,0)&4294967295)::oid AND objsubid=1)
$$;
CREATE FUNCTION dev_session.metadata_permitted(project text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM dev_session.project_deletions d WHERE d.project_id=project AND d.verified AND d.phases ? 'namespace'
 AND current_setting('crewstation.dev_session_deletion',true)=d.operation_id||':'||d.generation||':metadata'
 AND dev_session.work_locked(project,'ExclusiveLock',pg_backend_pid()))
$$;
CREATE FUNCTION dev_session.guard_content_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE backend integer;BEGIN
 IF TG_OP<>'INSERT' OR NEW.kind NOT IN('project','task','cluster-operation') OR NEW.id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR NEW.project_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR NEW.key='' OR NEW.identity IS DISTINCT FROM dev_session.work_digest(jsonb_build_object('kind',NEW.kind,'key',NEW.key,'id',NEW.id,'projectId',NEW.project_id))
 OR current_setting('crewstation.dev_session_origin',true) IS DISTINCT FROM dev_session.work_digest(jsonb_build_object('kind',NEW.kind,'key',NEW.key,'id',NEW.id,'projectId',NEW.project_id,'identity',NEW.identity)) THEN
 RAISE EXCEPTION 'Development content origin requires the immutable original public source';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 IF NOT COALESCE(dev_session.work_admitted(NEW.project_id,backend),false) AND NOT dev_session.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dev-session.project-admission:'||NEW.project_id,0));END IF;
 IF EXISTS(SELECT 1 FROM dev_session.project_admissions WHERE project_id=NEW.project_id)
 AND NOT(dev_session.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) AND split_part(current_setting('crewstation.dev_session_deletion',true),':',3)='seal') THEN
 RAISE EXCEPTION 'Development original source cannot enter a closed project';END IF;RETURN NEW;
END $$;
CREATE TRIGGER development_content_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON dev_session.content_origins FOR EACH ROW EXECUTE FUNCTION dev_session.guard_content_origin();

CREATE FUNCTION dev_session.guard_content_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Development deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.dev_session_deletion',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify') OR NEW.generation<1 OR NEW.revision!~'^[a-f0-9]{64}$'
 OR current_setting('crewstation.dev_session_deletion',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
 OR NOT dev_session.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) THEN RAISE EXCEPTION 'Development deletion requires its original exclusive grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation) THEN RAISE EXCEPTION 'Development original deletion cannot be replaced';END IF;
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision THEN
 IF OLD.verified AND NOT NEW.verified OR NOT NEW.phases @> OLD.phases THEN RAISE EXCEPTION 'Development original phase proof cannot be replaced';END IF;
 IF NEW.body IS DISTINCT FROM OLD.body AND NOT(phase='metadata' AND OLD.phases ? 'namespace' AND NEW.body=OLD.body||'{"contents":[],"callbacks":[],"compacted":true}'::jsonb) THEN
 RAISE EXCEPTION 'Development frozen original content cannot be replaced';END IF;
 ELSIF TG_OP='UPDATE' AND(NEW.generation<=OLD.generation OR phase<>'seal' OR NEW.phases<>'{}'::jsonb) THEN RAISE EXCEPTION 'Development renewed inventory requires a later seal';END IF;RETURN NEW;
END $$;
CREATE TRIGGER development_content_deletion_guard BEFORE INSERT OR UPDATE OR DELETE ON dev_session.project_deletions FOR EACH ROW EXECUTE FUNCTION dev_session.guard_content_deletion();

-- Every body carries only its original direct parent links. The original directory remains after the payload is removed.
CREATE FUNCTION dev_session.content_links(table_name text,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb:=jsonb_build_object('workspace',body->'task_id','project',body->'project_id');BEGIN
 CASE table_name
 WHEN 'native_terminal_starts' THEN result:=result||jsonb_build_object('runtime',body->'execution_task_id','previous',body->'execution'->'previousTaskId','agent',body->'agent_id');
 WHEN 'agent_starts' THEN result:=result||jsonb_build_object('runtime',body->'execution_task_id','previous',body->'execution'->'previousTaskId','agent',body->'agent_id');
 WHEN 'native_activity_states','native_activity_items','native_activity_reads' THEN result:=result||jsonb_build_object('agent',body->'agent_id');
 WHEN 'native_activity_sources' THEN result:=result||jsonb_build_object('runtime',body->'source_task_id');
 WHEN 'cluster_agent_restarts' THEN result:=jsonb_build_object('operation',body->'operation_id','runtime',body->'task_id','agent',body->'agent_id');
 WHEN 'development_agent_usage' THEN result:=result||jsonb_build_object('workspace',body->'workspace_task_id','runtime',body->'execution_task_id');
 WHEN 'development_agent_endings' THEN SELECT jsonb_build_object('workspace',workspace_task_id,'project',project_id,'runtime',execution_task_id) INTO result
   FROM dev_session.development_agent_usage WHERE execution_task_id=body->>'execution_task_id';
   IF result IS NULL THEN RAISE EXCEPTION 'Development ending has no original usage parent';END IF;
 ELSE NULL;
 END CASE;RETURN result;
END $$;
CREATE FUNCTION dev_session.guard_all_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb;links jsonb;previous jsonb;projects text[]:=ARRAY[]::text[];original text;field text;backend integer;BEGIN
 body:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;links:=dev_session.content_links(TG_TABLE_NAME,body);
 IF TG_OP='UPDATE' THEN previous:=dev_session.content_links(TG_TABLE_NAME,to_jsonb(OLD));
 IF previous IS DISTINCT FROM links THEN RAISE EXCEPTION 'Development original parent and project links cannot be replaced';END IF;END IF;
 IF NULLIF(links->>'project','') IS NOT NULL THEN projects:=array_append(projects,links->>'project');END IF;
 IF NOT EXISTS(SELECT 1 FROM dev_session.content_origins WHERE(kind='task' AND key IN(links->>'workspace',links->>'runtime',links->>'previous'))
 OR(kind='cluster-operation' AND key=links->>'operation')) AND cardinality(projects)=0 THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dev-session.content-origins',0));END IF;
 FOREACH field IN ARRAY ARRAY['workspace','runtime','previous','operation'] LOOP
 IF NULLIF(links->>field,'') IS NULL THEN CONTINUE;END IF;
 SELECT project_id INTO original FROM dev_session.content_origins WHERE kind=CASE WHEN field='operation' THEN 'cluster-operation' ELSE 'task' END AND key=links->>field;
 IF original IS NOT NULL THEN projects:=array_append(projects,original);END IF;END LOOP;
 IF (SELECT count(DISTINCT item) FROM unnest(projects) item)>1 THEN RAISE EXCEPTION 'Development original content project links conflict';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 FOREACH original IN ARRAY projects LOOP
 IF NOT COALESCE(dev_session.work_admitted(original,backend),false) AND NOT dev_session.work_locked(original,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('dev-session.project-admission:'||original,0));END IF;
 IF EXISTS(SELECT 1 FROM dev_session.project_admissions WHERE project_id=original) AND NOT(TG_OP='DELETE' AND dev_session.metadata_permitted(original)) THEN
 RAISE EXCEPTION 'Development project content admission is permanently sealed';END IF;END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['idle_reminders','native_terminal_starts','workspace_layouts','native_activity_progress','native_activity_states','native_activity_items','native_activity_reads','native_activity_sources','agent_starts','comparison_references','cluster_agent_restarts','development_agent_usage','development_agent_endings'] LOOP
 EXECUTE format('CREATE TRIGGER development_all_content_guard BEFORE INSERT OR UPDATE OR DELETE ON dev_session.%I FOR EACH ROW EXECUTE FUNCTION dev_session.guard_all_content()',table_name);
 EXECUTE format('CREATE TRIGGER development_all_content_truncate BEFORE TRUNCATE ON dev_session.%I FOR EACH STATEMENT EXECUTE FUNCTION dev_session.reject_work_truncate()',table_name);END LOOP;
 FOREACH table_name IN ARRAY ARRAY['content_origins','project_deletions'] LOOP
 EXECUTE format('CREATE TRIGGER development_content_state_truncate BEFORE TRUNCATE ON dev_session.%I FOR EACH STATEMENT EXECUTE FUNCTION dev_session.reject_work_truncate()',table_name);END LOOP;
END $$;
CREATE OR REPLACE FUNCTION dev_session.guard_work_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;private_key text:=current_setting('crewstation.dev_session_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN IF OLD.exited_at IS NULL OR NOT dev_session.metadata_permitted(OLD.project_id) THEN RAISE EXCEPTION 'Original development callbacks require a completed metadata owner';END IF;RETURN OLD;END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF dev_session.work_birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('project-api','task-api','agent-dispatch','native-dispatch','reminder','usage','ending','effect') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
    OR NOT dev_session.work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Development callback requires actual admitted original birth';END IF;
  IF NOT EXISTS(SELECT 1 FROM dev_session.content_origins WHERE kind=NEW.origin_kind AND key=NEW.origin_key AND id=NEW.origin_id AND project_id=NEW.project_id)
    OR(NEW.origin_kind='project' AND NEW.origin_id<>NEW.project_id) THEN RAISE EXCEPTION 'Development callback requires its immutable original public source';END IF;
  IF EXISTS(SELECT 1 FROM dev_session.project_admissions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'Development admission is permanently sealed';END IF;
  RETURN NEW;
 END IF;
 before_body:=to_jsonb(OLD);
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
   OR NEW.exit_digest IS DISTINCT FROM dev_session.work_identity(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Original development callback identity is immutable';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF private_key IS NULL OR dev_session.work_digest(to_jsonb(private_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Development exit requires the private original finally';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM dev_session.callback_pod_stops WHERE identity=current_setting('crewstation.dev_session_pod_recovery',true)
   AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['containerId','pid','pidNamespace','bootId','startTicks']) THEN RAISE EXCEPTION 'Development recovery requires original whole Pod stop proof';END IF;
 END IF;
 RETURN NEW;
END $$;
