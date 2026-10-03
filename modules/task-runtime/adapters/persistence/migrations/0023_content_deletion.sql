-- RFC-037: permanent payload fences and an exclusive metadata journal. Historical SQL and private finally facts stay intact.
CREATE TABLE task_runtime.project_deletions(project_id text PRIMARY KEY,operation_id text NOT NULL,generation integer NOT NULL,revision text NOT NULL,
 body jsonb NOT NULL,phases jsonb NOT NULL DEFAULT '{}'::jsonb,verified boolean NOT NULL);
CREATE FUNCTION task_runtime.metadata_permitted(project text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM task_runtime.project_deletions d JOIN task_runtime.project_admissions a USING(project_id)
 WHERE d.project_id=project AND d.verified AND d.phases ? 'namespace' AND a.operation_id=d.operation_id AND a.generation=d.generation
 AND current_setting('crewstation.task_runtime_deletion',true)=d.operation_id||':'||d.generation||':metadata'
 AND task_runtime.work_locked(project,'ExclusiveLock',pg_backend_pid()))
 AND NOT EXISTS(SELECT 1 FROM task_runtime.original_callbacks WHERE project_id=project AND exited_at IS NULL)
$$;
CREATE FUNCTION task_runtime.stop_write_permitted(project text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT task_runtime.work_admitted(project,backend) AND EXISTS(SELECT 1 FROM task_runtime.original_callbacks c
 JOIN task_runtime.project_admissions a USING(project_id) WHERE c.project_id=project AND c.backend_pid=backend AND c.exited_at IS NULL
 AND c.deletion_grant->>'phase'='stop' AND c.deletion_grant->>'operationId'=a.operation_id AND(c.deletion_grant->>'generation')::integer=a.generation)
$$;
CREATE FUNCTION task_runtime.guard_content_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;stopped jsonb;stop_snapshot boolean;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Runtime deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.task_runtime_deletion',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify') OR NEW.generation<1 OR NEW.revision!~'^[a-f0-9]{64}$'
 OR current_setting('crewstation.task_runtime_deletion',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
 OR NOT task_runtime.work_locked(NEW.project_id,'ExclusiveLock',pg_backend_pid())
 OR NOT EXISTS(SELECT 1 FROM task_runtime.project_admissions a WHERE a.project_id=NEW.project_id AND a.operation_id=NEW.operation_id AND a.generation=NEW.generation)
 THEN RAISE EXCEPTION 'Runtime deletion requires its original exclusive grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation) THEN RAISE EXCEPTION 'Runtime original deletion cannot be replaced';END IF;
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision THEN
 IF OLD.verified AND NOT NEW.verified OR NOT NEW.phases @> OLD.phases THEN RAISE EXCEPTION 'Runtime original phase proof cannot be replaced';END IF;
 stopped:=NEW.body->'stopped';
 stop_snapshot:=phase='stop' AND COALESCE(OLD.body->'stopped','null'::jsonb)='null'::jsonb AND OLD.body->>'compacted'='false'
 AND jsonb_typeof(stopped)='object' AND stopped ?& ARRAY['contents','callbacks','count','digest'] AND stopped-ARRAY['contents','callbacks','count','digest']='{}'::jsonb
 AND jsonb_typeof(stopped->'contents')='array' AND jsonb_typeof(stopped->'callbacks')='array'
 AND stopped->'count'=to_jsonb(jsonb_array_length(stopped->'contents')) AND stopped->>'digest'=task_runtime.work_digest(jsonb_build_object('contents',stopped->'contents','callbacks',stopped->'callbacks'))
 AND NEW.body=OLD.body||jsonb_build_object('stopped',stopped) AND NOT EXISTS(SELECT 1 FROM task_runtime.original_callbacks WHERE project_id=NEW.project_id AND exited_at IS NULL);
 IF NEW.body IS DISTINCT FROM OLD.body AND NOT COALESCE(stop_snapshot,false)
 AND NOT(phase='metadata' AND OLD.phases ? 'namespace' AND NEW.body=OLD.body||'{"contents":[],"callbacks":[],"stopped":null,"compacted":true}'::jsonb) THEN
 RAISE EXCEPTION 'Runtime frozen original content cannot be replaced';END IF;
 ELSIF TG_OP='UPDATE' AND(NEW.generation<=OLD.generation OR phase<>'seal' OR NEW.phases<>'{}'::jsonb) THEN RAISE EXCEPTION 'Runtime renewed inventory requires a later seal';END IF;RETURN NEW;
END $$;
CREATE TRIGGER runtime_content_deletion_guard BEFORE INSERT OR UPDATE OR DELETE ON task_runtime.project_deletions FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_content_deletion();
CREATE TRIGGER runtime_content_deletion_truncate BEFORE TRUNCATE ON task_runtime.project_deletions FOR EACH STATEMENT EXECUTE FUNCTION task_runtime.reject_work_truncate();

-- Direct immutable roots plus original parent keys. Moving lifecycle state or publishing a rebuild never changes the original project/task.
CREATE FUNCTION task_runtime.content_links(table_name text,body jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb:=jsonb_build_object('project',body->'project_id','service',body->'service_id','task',body->'task_id');BEGIN
 CASE table_name
 WHEN 'environments' THEN result:=result||jsonb_build_object('task',body->'id','parent',body->'native'->'parentTaskId','rebuild',body->'rebuild_id','ending',body->'parent_ending'->'endingId');
 IF body->>'kind'='profile-test' THEN result:=result||jsonb_build_object('project',body->'render'->'runtimeValidation'->'projectId','service',NULL);END IF;
 WHEN 'environment_rebuilds' THEN result:=result||jsonb_build_object('rebuild',body->'id');
 WHEN 'archive_executions' THEN result:=result||jsonb_build_object('project',body->'body'->'projectId','service',body->'body'->'serviceId','bodyTask',body->'body'->'taskId');
 WHEN 'unprovisioned_storage' THEN result:=result||jsonb_build_object('project',body->'body'->'input'->'projectId','service',body->'body'->'input'->'serviceId','bodyTask',body->'body'->'input'->'taskId');
 WHEN 'development_parent_endings' THEN result:=result||jsonb_build_object('task',body->'parent_id','service',body->'epoch'->'serviceId','ending',body->'id');
 WHEN 'development_parent_ending_children' THEN result:=result||jsonb_build_object('project',body->'snapshot'->'project_id','service',body->'snapshot'->'service_id',
 'task',body->'child_id','parent',body->'snapshot'->'native'->'parentTaskId','ending',body->'ending_id');
 WHEN 'development_parent_ending_objects' THEN result:=result||jsonb_build_object('ending',body->'ending_id');
 WHEN 'development_parent_rebuild_claims' THEN result:=result||jsonb_build_object('ending',body->'source_ending_id','rebuild',body->'current_rebuild_id');
 ELSE NULL;
 END CASE;RETURN result;
END $$;
CREATE FUNCTION task_runtime.content_projects(links jsonb) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT COALESCE(array_agg(DISTINCT project),'{}'::text[]) FROM (
 SELECT COALESCE((SELECT project_id FROM task_runtime.work_origins WHERE kind='project' AND key=links->>'project'),NULLIF(links->>'project','')) AS project
 UNION SELECT project_id FROM task_runtime.work_origins WHERE(kind='service' AND key=links->>'service')
 OR(kind='task' AND key IN(links->>'task',links->>'parent',links->>'bodyTask')) OR(kind='rebuild' AND key=links->>'rebuild') OR(kind='parent-ending' AND key=links->>'ending')
 UNION SELECT CASE WHEN kind='profile-test' THEN render->'runtimeValidation'->>'projectId' ELSE project_id END FROM task_runtime.environments
 WHERE id IN(links->>'task',links->>'parent',links->>'bodyTask') OR service_id=links->>'service'
 UNION SELECT project_id FROM task_runtime.environment_rebuilds WHERE id=links->>'rebuild'
 UNION SELECT project_id FROM task_runtime.development_parent_endings WHERE id=links->>'ending'
 ) original WHERE project IS NOT NULL
$$;
CREATE FUNCTION task_runtime.guard_all_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb;links jsonb;previous jsonb;projects text[];original text;backend integer;BEGIN
 body:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;links:=task_runtime.content_links(TG_TABLE_NAME,body);
 IF TG_OP='UPDATE' THEN previous:=task_runtime.content_links(TG_TABLE_NAME,to_jsonb(OLD));
 IF previous->'project' IS DISTINCT FROM links->'project' OR previous->'service' IS DISTINCT FROM links->'service'
 OR previous->'task' IS DISTINCT FROM links->'task' OR previous->'parent' IS DISTINCT FROM links->'parent' OR previous->'bodyTask' IS DISTINCT FROM links->'bodyTask'
 OR TG_TABLE_NAME IN('development_parent_ending_children','development_parent_ending_objects','development_parent_rebuild_claims') AND previous->'ending' IS DISTINCT FROM links->'ending'
 THEN RAISE EXCEPTION 'Runtime original project service task and parent links cannot be replaced';END IF;END IF;
 projects:=task_runtime.content_projects(links);
 IF cardinality(projects)=0 THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('task-runtime.content-origins',0));projects:=task_runtime.content_projects(links);END IF;
 IF cardinality(projects)>1 THEN RAISE EXCEPTION 'Runtime original content project links conflict';END IF;
 BEGIN backend:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;EXCEPTION WHEN OTHERS THEN backend:=NULL;END;
 FOREACH original IN ARRAY projects LOOP
 IF NOT COALESCE(task_runtime.work_admitted(original,backend),false) AND NOT task_runtime.work_locked(original,'ExclusiveLock',pg_backend_pid()) THEN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('task-runtime.project-admission:'||original,0));END IF;
 IF EXISTS(SELECT 1 FROM task_runtime.project_admissions WHERE project_id=original) AND NOT(TG_OP='DELETE' AND task_runtime.metadata_permitted(original))
 AND NOT(COALESCE(task_runtime.stop_write_permitted(original,backend),false) AND(TG_OP='UPDATE'
 OR TG_OP='INSERT' AND TG_TABLE_NAME IN('blocked_admissions','development_parent_endings','development_parent_ending_children','development_parent_ending_objects'))) THEN
 RAISE EXCEPTION 'Runtime project content admission is permanently sealed';END IF;END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['environments','admissions','environment_rebuilds','blocked_admissions','archive_executions','unprovisioned_storage',
 'development_parent_endings','development_parent_ending_children','development_parent_ending_objects','development_parent_rebuild_claims'] LOOP
 EXECUTE format('CREATE TRIGGER runtime_all_content_guard BEFORE INSERT OR UPDATE OR DELETE ON task_runtime.%I FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_all_content()',table_name);
 EXECUTE format('CREATE TRIGGER runtime_all_content_truncate BEFORE TRUNCATE ON task_runtime.%I FOR EACH STATEMENT EXECUTE FUNCTION task_runtime.reject_work_truncate()',table_name);END LOOP;
END $$;

-- Fixed original membership remains immutable during execution. Only the completed original metadata grant can remove it.
CREATE OR REPLACE FUNCTION task_runtime.guard_parent_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen boolean;ending_key text;project text;BEGIN
 IF TG_OP='DELETE' THEN ending_key:=OLD.ending_id;ELSE ending_key:=NEW.ending_id;END IF;
 SELECT membership_frozen,project_id INTO frozen,project FROM task_runtime.development_parent_endings WHERE id=ending_key FOR UPDATE;
 IF frozen AND NOT(TG_OP='DELETE' AND task_runtime.metadata_permitted(project)) THEN RAISE EXCEPTION 'development parent fixed membership cannot change';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;

CREATE OR REPLACE FUNCTION task_runtime.guard_work_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;private_key text:=current_setting('crewstation.task_runtime_callback_exit',true);BEGIN
 IF TG_OP='DELETE' THEN IF OLD.exited_at IS NULL OR NOT task_runtime.metadata_permitted(OLD.project_id) THEN RAISE EXCEPTION 'Original runtime callbacks require a completed metadata owner';END IF;RETURN OLD;END IF;
 after_body:=to_jsonb(NEW);
 IF TG_OP='INSERT' THEN
  IF task_runtime.work_birth_valid(after_body) IS DISTINCT FROM true OR NEW.kind NOT IN('project-api','service-api','task-api','native-job','rebuild-job','parent-ending','reconcile','observe-startup','archive','ledger-resync','parent-recovery','deletion','effect') OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
    OR NOT task_runtime.work_admitted(NEW.project_id,NEW.backend_pid) THEN RAISE EXCEPTION 'Runtime callback requires actual admitted original birth';END IF;
  IF NOT EXISTS(SELECT 1 FROM task_runtime.work_origins WHERE kind=NEW.origin_kind AND key=NEW.origin_key AND id=NEW.origin_id AND project_id=NEW.project_id AND revision=NEW.origin_revision) THEN RAISE EXCEPTION 'Runtime callback requires its original immutable source';END IF;
  IF NEW.deletion_grant IS NULL THEN
   IF NEW.kind='deletion' OR EXISTS(SELECT 1 FROM task_runtime.project_admissions WHERE project_id=NEW.project_id) THEN RAISE EXCEPTION 'Runtime admission is permanently sealed';END IF;
  ELSE
   IF NOT task_runtime.work_granted(NEW.project_id,NEW.deletion_grant) OR NEW.kind NOT IN('deletion','effect') THEN RAISE EXCEPTION 'Runtime cleanup requires the current original deletion phase';END IF;
  END IF;
  RETURN NEW;
 END IF;
 before_body:=to_jsonb(OLD);
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
   OR NEW.exit_digest IS DISTINCT FROM task_runtime.work_identity(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Original runtime callback identity is immutable';END IF;
 IF NEW.recovery_digest IS NULL THEN
  IF private_key IS NULL OR task_runtime.work_digest(to_jsonb(private_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Runtime exit requires the private original finally';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM task_runtime.callback_pod_stops WHERE identity=current_setting('crewstation.task_runtime_pod_recovery',true)
   AND digest=NEW.recovery_digest AND original_process=OLD.original_process-ARRAY['containerId','pid','pidNamespace','bootId','startTicks']) THEN RAISE EXCEPTION 'Runtime recovery requires original whole Pod stop proof';END IF;
 END IF;
 RETURN NEW;
END $$;
