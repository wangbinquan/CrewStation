-- Append-only project fence and minimum original ownership. No existing data row is rewritten.
CREATE TABLE data.content_origins(kind text NOT NULL,key text NOT NULL,id text NOT NULL,project_id text NOT NULL,identity text NOT NULL,PRIMARY KEY(kind,key));
CREATE TABLE data.project_deletions(project_id text PRIMARY KEY,operation_id text NOT NULL,generation integer NOT NULL CHECK(generation>0),revision text NOT NULL,body jsonb NOT NULL,phases jsonb NOT NULL DEFAULT '{}'::jsonb,verified boolean NOT NULL,source_identity text);
CREATE FUNCTION data.deletion_locked(project text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
 AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
 AND classid=((hashtextextended('data.project-admission:'||project,0)>>32)&4294967295)::oid
 AND objid=(hashtextextended('data.project-admission:'||project,0)&4294967295)::oid AND objsubid=1 AND mode='ExclusiveLock')
$$;
CREATE FUNCTION data.content_project(kind text,key text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE project text;parent text;
BEGIN
 IF key IS NULL OR key='' THEN RETURN NULL;END IF;
 SELECT project_id INTO project FROM data.content_origins o WHERE o.kind=$1 AND o.key=$2;
 IF FOUND THEN RETURN project;END IF;
 IF kind='project' THEN RETURN key;
 ELSIF kind='space' THEN SELECT project_id INTO project FROM data.object_spaces WHERE id=key;
 ELSIF kind='resource' THEN SELECT project_id INTO project FROM data.resources WHERE id=key;
 ELSIF kind='data-binding' THEN SELECT project_id INTO project FROM data.task_bindings WHERE id=key;
 ELSIF kind='task' THEN SELECT body->>'projectId' INTO project FROM data.task_object_inputs WHERE task_id=key;
 ELSIF kind='object' THEN SELECT space_id INTO parent FROM data.objects WHERE id=key;project:=data.content_project('space',parent);
 ELSIF kind='upload' THEN SELECT space_id INTO parent FROM data.object_uploads WHERE id=key;project:=data.content_project('space',parent);
 ELSIF kind='attempt' THEN SELECT space_id INTO parent FROM data.object_upload_attempts WHERE id=key;project:=data.content_project('space',parent);
 ELSIF kind='read-transfer' THEN SELECT space_id INTO parent FROM data.object_read_transfers WHERE id=key;project:=data.content_project('space',parent);
 ELSIF kind='archive-binding' THEN SELECT space_id INTO parent FROM data.finalization_bindings WHERE id=key;project:=data.content_project('space',parent);
 ELSIF kind='archive-plan' THEN SELECT space_id INTO parent FROM data.archive_plans WHERE id=key;project:=data.content_project('space',parent);
 ELSIF kind='helper' THEN SELECT binding_id INTO parent FROM data.archive_helper_grants WHERE id=key;project:=data.content_project('archive-binding',parent);
 ELSIF kind='input-grant' THEN SELECT task_id INTO parent FROM data.task_input_grants WHERE id=key;project:=data.content_project('task',parent);
 END IF;
 RETURN project;
END $$;
CREATE FUNCTION data.content_projects(table_name text,snapshot jsonb) RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE projects text[];kind text;project text;entry record;
BEGIN
 projects:=ARRAY[]::text[];
 FOR entry IN SELECT * FROM (VALUES
  ('project',snapshot->>'project_id'),('project',snapshot->'body'->>'projectId'),
  ('service',snapshot->>'service_id'),('service',snapshot->'body'->>'serviceId'),
  ('task',snapshot->>'task_id'),('task',snapshot->'body'->>'taskId'),
  ('space',snapshot->>'space_id'),('space',snapshot->'body'->>'spaceId'),
  ('object',snapshot->>'object_id'),('object',snapshot->'body'->>'objectId'),
  ('upload',snapshot->>'upload_id'),('upload',snapshot->'body'->>'uploadId'),
  ('archive-binding',snapshot->>'binding_id'),('archive-binding',snapshot->'body'->>'bindingId')) refs(kind,key) LOOP
  project:=data.content_project(entry.kind,entry.key);
  IF project IS NOT NULL THEN projects:=array_append(projects,project);END IF;
 END LOOP;
 kind:=CASE table_name WHEN 'resources' THEN 'resource' WHEN 'task_bindings' THEN 'data-binding' WHEN 'object_spaces' THEN 'space'
  WHEN 'objects' THEN 'object' WHEN 'object_uploads' THEN 'upload' WHEN 'object_upload_attempts' THEN 'attempt'
  WHEN 'object_read_transfers' THEN 'read-transfer' WHEN 'finalization_bindings' THEN 'archive-binding' WHEN 'archive_plans' THEN 'archive-plan'
  WHEN 'archive_helper_grants' THEN 'helper' WHEN 'archive_helper_closures' THEN 'helper' WHEN 'task_input_grants' THEN 'input-grant' ELSE NULL END;
 project:=data.content_project(kind,snapshot->>'id');
 IF project IS NOT NULL THEN projects:=array_append(projects,project);END IF;
 RETURN projects;
END $$;
CREATE FUNCTION data.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE projects text[];project text;scope data.project_deletions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('data.object-storage',0));
 projects:=ARRAY[]::text[];
 IF TG_OP<>'INSERT' THEN projects:=projects||data.content_projects(TG_TABLE_NAME,to_jsonb(OLD));END IF;
 IF TG_OP<>'DELETE' THEN projects:=projects||data.content_projects(TG_TABLE_NAME,to_jsonb(NEW));END IF;
 FOR project IN SELECT DISTINCT value FROM unnest(projects) value ORDER BY value LOOP
  SELECT * INTO scope FROM data.project_deletions WHERE project_id=project;
  IF FOUND AND NOT coalesce((TG_OP='DELETE' AND scope.verified AND scope.phases ? 'namespace'
   AND data.deletion_locked(project) AND current_setting('crewstation.data_deletion',true)=scope.operation_id||':'||scope.generation||':metadata'),false) THEN
   RAISE EXCEPTION 'data project content is sealed for deletion' USING ERRCODE='55000';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE FUNCTION data.guard_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'data deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.data_deletion',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify')
  OR current_setting('crewstation.data_deletion',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
  OR NOT data.deletion_locked(NEW.project_id) OR NEW.revision!~'^[a-f0-9]{64}$' OR jsonb_typeof(NEW.body)<>'object' THEN
  RAISE EXCEPTION 'data deletion requires the original exclusive grant';END IF;
 IF TG_OP='INSERT' AND (phase<>'seal' OR NEW.phases<>'{}'::jsonb) THEN RAISE EXCEPTION 'data original scope requires seal';END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation THEN RAISE EXCEPTION 'data original deletion cannot be replaced';END IF;
  IF NEW.revision=OLD.revision THEN
   IF OLD.verified AND NOT NEW.verified OR NEW.source_identity IS DISTINCT FROM OLD.source_identity OR NOT NEW.phases @> OLD.phases THEN RAISE EXCEPTION 'data original phase or source cannot be replaced';END IF;
   IF NEW.body IS DISTINCT FROM OLD.body AND NOT(phase='metadata' AND OLD.phases ? 'namespace' AND NEW.body=OLD.body||'{"contents":[],"compacted":true}'::jsonb) THEN RAISE EXCEPTION 'data original scope cannot be replaced';END IF;
  ELSIF NEW.generation<=OLD.generation OR phase<>'seal' OR NEW.phases<>'{}'::jsonb THEN RAISE EXCEPTION 'data renewed scope requires later seal';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION data.guard_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deletion_permit text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'data original identity cannot be replaced';END IF;
 deletion_permit:=current_setting('crewstation.data_deletion',true);
 IF deletion_permit IS NULL OR split_part(deletion_permit,':',3)<>'seal' OR NOT data.deletion_locked(NEW.project_id) OR NEW.identity!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'data origin requires original seal';END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION data.reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'data project content and original identities cannot be truncated';END $$;
CREATE FUNCTION data.guard_backup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('data.object-storage',0));
 IF EXISTS(SELECT 1 FROM data.project_deletions WHERE NOT phases ? 'verify') THEN
  RAISE EXCEPTION 'full database backup cannot export a sealed project' USING ERRCODE='55000';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE TRIGGER data_original_deletion BEFORE INSERT OR UPDATE OR DELETE ON data.project_deletions FOR EACH ROW EXECUTE FUNCTION data.guard_deletion();
CREATE TRIGGER data_original_identity BEFORE INSERT OR UPDATE OR DELETE ON data.content_origins FOR EACH ROW EXECUTE FUNCTION data.guard_origin();
CREATE TRIGGER data_backup_deletion_fence BEFORE INSERT OR UPDATE OR DELETE ON data.object_backups FOR EACH ROW EXECUTE FUNCTION data.guard_backup();
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['resources','task_bindings','resource_allocations','object_project_policies','object_spaces','object_uploads','object_upload_attempts','objects','object_references','object_mutations','object_read_transfers','object_write_control','archive_plans','finalization_bindings','archive_binding_revisions','archive_helper_grants','archive_helper_closures','archive_file_results','task_object_inputs','task_input_grants'] LOOP
  EXECUTE format('CREATE TRIGGER data_project_content BEFORE INSERT OR UPDATE OR DELETE ON data.%I FOR EACH ROW EXECUTE FUNCTION data.guard_content()',table_name);
  EXECUTE format('CREATE TRIGGER data_project_truncate BEFORE TRUNCATE ON data.%I FOR EACH STATEMENT EXECUTE FUNCTION data.reject_truncate()',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['project_deletions','content_origins'] LOOP
  EXECUTE format('CREATE TRIGGER data_original_truncate BEFORE TRUNCATE ON data.%I FOR EACH STATEMENT EXECUTE FUNCTION data.reject_truncate()',table_name);
 END LOOP;
END $$;
