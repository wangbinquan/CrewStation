-- Closed admission persists beyond all recoverable business content. No historical migration is rewritten.
CREATE TABLE business_task.content_origins(kind text NOT NULL,key text NOT NULL,id text NOT NULL,project_id text NOT NULL,identity text NOT NULL,PRIMARY KEY(kind,key));
CREATE TABLE business_task.project_deletions(project_id text PRIMARY KEY,operation_id text NOT NULL,generation integer NOT NULL,revision text NOT NULL,
 body jsonb NOT NULL,phases jsonb NOT NULL DEFAULT '{}'::jsonb,verified boolean NOT NULL);
CREATE OR REPLACE FUNCTION business_task.work_locked(project text,lock_mode text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=backend AND granted AND mode=lock_mode
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND classid=((hashtextextended('business-task.project-admission:'||project,0)>>32)&4294967295)::oid
 AND objid=(hashtextextended('business-task.project-admission:'||project,0)&4294967295)::oid AND objsubid=1)
$$;
CREATE FUNCTION business_task.metadata_permitted(project text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM business_task.project_deletions d WHERE d.project_id=project AND d.verified AND d.phases ? 'namespace'
 AND current_setting('crewstation.business_task_deletion',true)=d.operation_id||':'||d.generation||':metadata'
 AND business_task.work_locked(project,'ExclusiveLock',pg_backend_pid()))
$$;
CREATE FUNCTION business_task.guard_content_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE backend integer;BEGIN
 IF TG_OP<>'INSERT' OR NEW.kind NOT IN('service','task') OR NEW.id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 OR NEW.project_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR NEW.key='' OR NEW.identity IS DISTINCT FROM business_task.work_digest(jsonb_build_object('kind',NEW.kind,'key',NEW.key,'id',NEW.id,'projectId',NEW.project_id))
 OR current_setting('crewstation.business_task_origin',true) IS DISTINCT FROM business_task.work_digest(jsonb_build_object('kind',NEW.kind,'key',NEW.key,'id',NEW.id,'projectId',NEW.project_id,'identity',NEW.identity)) THEN
 RAISE EXCEPTION 'Business content origin requires the immutable original public source';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 IF NOT COALESCE(business_task.work_admitted(NEW.project_id,backend),false) AND NOT business_task.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('business-task.project-admission:'||NEW.project_id,0));END IF;
 IF EXISTS(SELECT 1 FROM business_task.project_admissions WHERE project_id=NEW.project_id)
 AND NOT(business_task.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) AND split_part(current_setting('crewstation.business_task_deletion',true),':',3)='seal') THEN
 RAISE EXCEPTION 'Business original source cannot enter a closed project';END IF;RETURN NEW;
END $$;
CREATE TRIGGER business_content_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON business_task.content_origins FOR EACH ROW EXECUTE FUNCTION business_task.guard_content_origin();

-- Resolve children only through their original parents in this schema. After parent cleanup, an orphan is rejected.
CREATE FUNCTION business_task.content_links(table_name text,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE parent jsonb;result jsonb:=jsonb_build_object('service',body->'service_id','project',body->'project_id','task',body->'task_id');BEGIN
 CASE table_name
 WHEN 'tasks' THEN result:=result||jsonb_build_object('task',body->'id');
 WHEN 'execution_operations' THEN result:=result||jsonb_build_object('project',body->'intent'->'projectId','task',body->'intent'->'task'->'id');
 WHEN 'subtasks' THEN result:=result||jsonb_build_object('runtime',body->'spec'->'execution'->'taskId');
 WHEN 'cluster_commands' THEN result:=result||jsonb_build_object('runtime',body->'body'->'operation'->'target'->'taskId','legacy',body->'legacy_body'->'operation'->'target'->'taskId');
 WHEN 'execution_subtasks' THEN result:=result||jsonb_build_object('runtime',body->'runtime_task_id','home',body->'session_key');
 WHEN 'execution_messages' THEN result:=result||jsonb_build_object('runtime',body->'runtime_task_id');
 WHEN 'execution_sessions' THEN result:=result||jsonb_build_object('runtime',body->'session_key');
 WHEN 'execution_session_homes' THEN result:=result||jsonb_build_object('runtime',body->'session_key');
 WHEN 'legacy_mutations' THEN result:=result||jsonb_build_object('runtime',body->'task_id');
 WHEN 'finalizations' THEN result:=result||jsonb_build_object('project',body->'body'->'projectId');
 WHEN 'subtask_projections' THEN SELECT to_jsonb(p) INTO parent FROM business_task.execution_subtasks p WHERE id=body->>'subtask_id';
 WHEN 'recovery_audit' THEN SELECT to_jsonb(p) INTO parent FROM business_task.recovery_requests p WHERE id=body->>'request_id';
 WHEN 'finalization_execution_proofs' THEN SELECT to_jsonb(p)||jsonb_build_object('project_id',p.body->'projectId') INTO parent FROM business_task.finalizations p WHERE id=body->>'operation_id';
 WHEN 'finalization_revisions' THEN SELECT to_jsonb(p)||jsonb_build_object('project_id',p.body->'projectId') INTO parent FROM business_task.finalizations p WHERE id=body->>'finalization_id';
 ELSE NULL;
 END CASE;
 IF table_name IN('subtask_projections','recovery_audit','finalization_execution_proofs','finalization_revisions') THEN
 IF parent IS NULL THEN RAISE EXCEPTION 'Business child content has no original parent';END IF;
 result:=jsonb_build_object('service',parent->'service_id','project',parent->'project_id','task',parent->'task_id');END IF;
 RETURN result;
END $$;
CREATE FUNCTION business_task.guard_all_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb;links jsonb;previous jsonb;projects text[]:=ARRAY[]::text[];original text;field text;backend integer;BEGIN
 body:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;links:=business_task.content_links(TG_TABLE_NAME,body);
 IF TG_OP='UPDATE' THEN previous:=business_task.content_links(TG_TABLE_NAME,to_jsonb(OLD));
 IF previous->'service' IS DISTINCT FROM links->'service' OR previous->'project' IS DISTINCT FROM links->'project' OR previous->'task' IS DISTINCT FROM links->'task' THEN
 RAISE EXCEPTION 'Business content original project service and task cannot be replaced';END IF;END IF;
 IF NULLIF(links->>'project','') IS NOT NULL THEN projects:=array_append(projects,links->>'project');END IF;
 -- Unregistered historical service-only writes share a short registry barrier. A sealing owner freezes that directory before its final traversal.
 IF NOT EXISTS(SELECT 1 FROM business_task.content_origins WHERE (kind='service' AND key=links->>'service') OR(kind='task' AND key IN(links->>'task',links->>'runtime',links->>'home',links->>'legacy')))
 AND cardinality(projects)=0 THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended('business-task.content-origins',0));END IF;
 FOREACH field IN ARRAY ARRAY['service','task','runtime','home','legacy'] LOOP
 IF NULLIF(links->>field,'') IS NULL THEN CONTINUE;END IF;
 SELECT project_id INTO original FROM business_task.content_origins WHERE kind=CASE WHEN field='service' THEN 'service' ELSE 'task' END AND key=links->>field;
 IF original IS NOT NULL THEN projects:=array_append(projects,original);END IF;END LOOP;
 IF (SELECT count(DISTINCT item) FROM unnest(projects) item)>1 THEN RAISE EXCEPTION 'Business original content project links conflict';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 FOREACH original IN ARRAY projects LOOP
 IF NOT COALESCE(business_task.work_admitted(original,backend),false) AND NOT business_task.work_locked(original,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('business-task.project-admission:'||original,0));END IF;
 IF EXISTS(SELECT 1 FROM business_task.project_admissions WHERE project_id=original) AND NOT(TG_OP='DELETE' AND business_task.metadata_permitted(original)) THEN
 RAISE EXCEPTION 'Business project content admission is permanently sealed';END IF;END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE FUNCTION business_task.guard_content_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Business deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.business_task_deletion',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify') OR NEW.generation<1 OR NEW.revision!~'^[a-f0-9]{64}$'
 OR current_setting('crewstation.business_task_deletion',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
 OR NOT business_task.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid()) THEN RAISE EXCEPTION 'Business deletion requires its original exclusive grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation) THEN RAISE EXCEPTION 'Business original deletion cannot be replaced';END IF;
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision THEN
 IF OLD.verified AND NOT NEW.verified OR NOT NEW.phases @> OLD.phases THEN RAISE EXCEPTION 'Business original phase proof cannot be replaced';END IF;
 IF NEW.body IS DISTINCT FROM OLD.body AND NOT(phase='metadata' AND OLD.phases ? 'namespace' AND NEW.body=OLD.body||'{"contents":[],"callbacks":[],"compacted":true}'::jsonb) THEN
 RAISE EXCEPTION 'Business frozen original content cannot be replaced';END IF;
 ELSIF TG_OP='UPDATE' AND(NEW.generation<=OLD.generation OR phase<>'seal' OR NEW.phases<>'{}'::jsonb) THEN RAISE EXCEPTION 'Business renewed inventory requires a later seal';END IF;RETURN NEW;
END $$;
CREATE TRIGGER business_content_deletion_guard BEFORE INSERT OR UPDATE OR DELETE ON business_task.project_deletions FOR EACH ROW EXECUTE FUNCTION business_task.guard_content_deletion();
DROP TRIGGER business_task_admission_work_guard ON business_task.execution_operations;
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['tasks','subtasks','contracts','cluster_commands','execution_operations','execution_controls','legacy_mutations','execution_subtasks','subtask_projections','execution_events','execution_cancellations','execution_task_states','execution_lifecycles','execution_logs','execution_materials','execution_messages','execution_session_homes','execution_sessions','recovery_requests','recovery_audit','storage_control_outbox','finalizations','finalization_execution_proofs','finalization_revisions'] LOOP
 EXECUTE format('CREATE TRIGGER business_all_content_guard BEFORE INSERT OR UPDATE OR DELETE ON business_task.%I FOR EACH ROW EXECUTE FUNCTION business_task.guard_all_content()',table_name);
 EXECUTE format('CREATE TRIGGER business_all_content_truncate BEFORE TRUNCATE ON business_task.%I FOR EACH STATEMENT EXECUTE FUNCTION business_task.reject_work_truncate()',table_name);END LOOP;
 FOREACH table_name IN ARRAY ARRAY['content_origins','project_deletions'] LOOP
 EXECUTE format('CREATE TRIGGER business_content_state_truncate BEFORE TRUNCATE ON business_task.%I FOR EACH STATEMENT EXECUTE FUNCTION business_task.reject_work_truncate()',table_name);END LOOP;
END $$;

CREATE OR REPLACE FUNCTION business_task.guard_work_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;private_key text:=current_setting('crewstation.business_task_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN IF OLD.exited_at IS NULL OR NOT business_task.metadata_permitted(OLD.project_id) THEN RAISE EXCEPTION 'Original business callbacks require a completed metadata owner';END IF;RETURN OLD;END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF business_task.work_birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('task-admission','subtask','projection','cancellation','lifecycle','message','agent-cleanup','service-api','legacy-api','contract') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
    OR NOT business_task.work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Business callback requires actual admitted original birth';END IF;
  IF EXISTS(SELECT 1 FROM business_task.project_admissions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'Business admission is permanently sealed';END IF;
  RETURN NEW;
 END IF;
 before_body:=to_jsonb(OLD);
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
   OR NEW.exit_digest IS DISTINCT FROM business_task.work_identity(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Original business callback identity is immutable';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF private_key IS NULL OR business_task.work_digest(to_jsonb(private_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Business exit requires the private original finally';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM business_task.callback_pod_stops WHERE identity=current_setting('crewstation.business_task_pod_recovery',true)
   AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['containerId','pid','pidNamespace','bootId','startTicks']) THEN RAISE EXCEPTION 'Business recovery requires original whole Pod stop proof';END IF;
 END IF;
 RETURN NEW;
END $$;
