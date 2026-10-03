ALTER TABLE session.connections ADD COLUMN consumer_id text;
CREATE TABLE session.task_origins(task_key text PRIMARY KEY,task_id text NOT NULL,project_id text,identity text NOT NULL);
CREATE TABLE session.connection_births(
 id text PRIMARY KEY,task_key text NOT NULL,replica text NOT NULL,connected_at timestamptz NOT NULL,
 exit_key_hash text NOT NULL,identity text NOT NULL,backend_pid integer NOT NULL,
 exited_at timestamptz,exit_digest text,CHECK((exited_at IS NULL)=(exit_digest IS NULL))
);
CREATE INDEX session_connection_births_task ON session.connection_births(task_key,id);
CREATE TABLE session.project_deletions(
 project_id text PRIMARY KEY,operation_id text NOT NULL,generation integer NOT NULL,revision text NOT NULL,
 body jsonb NOT NULL,phases jsonb NOT NULL DEFAULT '{}'::jsonb,verified boolean NOT NULL
);
CREATE FUNCTION session.json_text(body jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;BEGIN
 IF jsonb_typeof(body)='object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||session.json_text(item),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(body) AS entry(key,item);
 ELSIF jsonb_typeof(body)='array' THEN SELECT '['||COALESCE(string_agg(session.json_text(item),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(body) WITH ORDINALITY AS entry(item,ordinal);
 ELSE result:=body::text;END IF;RETURN result;
END $$;
CREATE FUNCTION session.digest(body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(session.json_text(body),'UTF8')),'hex') $$;
CREATE FUNCTION session.admission_key(task text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN project_id IS NULL THEN 'session.platform-admission' ELSE 'session.project-admission:'||project_id END FROM session.task_origins WHERE task_key=task
$$;
CREATE FUNCTION session.locked(key text,lock_mode text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=backend AND granted AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
 AND classid=((hashtextextended(key,0)>>32)&4294967295)::oid AND objid=(hashtextextended(key,0)&4294967295)::oid AND objsubid=1 AND mode=lock_mode)
$$;
CREATE FUNCTION session.reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Session original identities and project content cannot be truncated';END $$;
CREATE FUNCTION session.guard_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP<>'INSERT' OR NEW.task_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR NEW.identity!~'^[a-f0-9]{64}$'
 OR current_setting('crewstation.session_origin',true) IS DISTINCT FROM session.digest(jsonb_build_object('key',NEW.task_key,'id',NEW.task_id,'projectId',NEW.project_id,'identity',NEW.identity)) THEN
 RAISE EXCEPTION 'Session task origin requires its public original source';END IF;RETURN NEW;
END $$;
CREATE TRIGGER session_task_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON session.task_origins FOR EACH ROW EXECUTE FUNCTION session.guard_origin();
CREATE FUNCTION session.guard_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task text;project text;scope session.project_deletions%ROWTYPE;key text;BEGIN
 task:=CASE WHEN TG_OP='DELETE' THEN OLD.task_id ELSE NEW.task_id END;
 IF TG_OP='UPDATE' AND OLD.task_id<>NEW.task_id THEN RAISE EXCEPTION 'Session original task identity cannot be replaced';END IF;
 SELECT project_id INTO project FROM session.task_origins WHERE task_key=task;
 key:=session.admission_key(task);
 IF key IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended(key,0));END IF;
 SELECT * INTO scope FROM session.project_deletions WHERE project_id=project;
 IF NOT FOUND THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_TABLE_NAME='connections' THEN
  IF TG_OP='UPDATE' AND to_jsonb(NEW)-'last_seen_at'=to_jsonb(OLD)-'last_seen_at' THEN RETURN NEW;END IF;
  IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM session.connection_births WHERE id=OLD.consumer_id AND exited_at IS NOT NULL) THEN RETURN OLD;END IF;
 END IF;
 IF TG_OP='DELETE' AND scope.verified AND scope.phases ? 'namespace'
  AND current_setting('crewstation.session_deletion',true)=scope.operation_id||':'||scope.generation||':metadata' THEN RETURN OLD;END IF;
 RAISE EXCEPTION 'Session project admission is closed';
END $$;
CREATE FUNCTION session.guard_birth() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project text;scope session.project_deletions%ROWTYPE;key text;BEGIN
 IF TG_OP='INSERT' THEN
  key:=session.admission_key(NEW.task_key);
  IF key IS NULL OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true)
   OR NOT session.locked(key,'ShareLock',NEW.backend_pid)
   OR NEW.exit_key_hash!~'^[a-f0-9]{64}$' OR NEW.identity IS DISTINCT FROM session.digest(jsonb_build_object('id',NEW.id,'taskId',NEW.task_key,'replica',NEW.replica,'at',to_char(NEW.connected_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'exitKeyHash',NEW.exit_key_hash))
   OR NOT EXISTS(SELECT 1 FROM session.connections WHERE task_id=NEW.task_key AND consumer_id=NEW.id AND replica=NEW.replica AND connected_at=NEW.connected_at) THEN
   RAISE EXCEPTION 'Session birth requires the original admitted connection';END IF;RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL OR to_jsonb(NEW)-ARRAY['exited_at','exit_digest'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['exited_at','exit_digest']
   OR NEW.exit_digest IS DISTINCT FROM OLD.identity OR session.digest(to_jsonb(current_setting('crewstation.session_exit',true))) IS DISTINCT FROM OLD.exit_key_hash THEN
   RAISE EXCEPTION 'Session exit requires its private original finally';END IF;RETURN NEW;
 END IF;
 SELECT project_id INTO project FROM session.task_origins WHERE task_key=OLD.task_key;
 SELECT * INTO scope FROM session.project_deletions WHERE project_id=project;
 IF NOT FOUND OR OLD.exited_at IS NULL OR NOT scope.verified OR NOT scope.phases ? 'namespace'
  OR current_setting('crewstation.session_deletion',true) IS DISTINCT FROM scope.operation_id||':'||scope.generation||':metadata' THEN
  RAISE EXCEPTION 'Session birth requires its completed metadata owner';END IF;RETURN OLD;
END $$;
CREATE TRIGGER session_connection_birth_guard BEFORE INSERT OR UPDATE OR DELETE ON session.connection_births FOR EACH ROW EXECUTE FUNCTION session.guard_birth();
CREATE FUNCTION session.guard_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE phase text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Session deletion tombstone cannot be removed';END IF;
 phase:=split_part(current_setting('crewstation.session_deletion',true),':',3);
 IF phase IS NULL OR phase NOT IN('seal','stop','purge','prove','namespace','metadata','verify')
  OR current_setting('crewstation.session_deletion',true) IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase
  OR NOT session.locked('session.project-admission:'||NEW.project_id,'ExclusiveLock',pg_backend_pid())
  OR NEW.generation<1 OR NEW.revision!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Session deletion requires the original exclusive grant';END IF;
 IF TG_OP='UPDATE' AND(NEW.project_id<>OLD.project_id OR NEW.operation_id<>OLD.operation_id OR NEW.generation<OLD.generation) THEN RAISE EXCEPTION 'Session deletion original operation cannot be replaced';END IF;
 IF TG_OP='UPDATE' AND NEW.revision=OLD.revision THEN
  IF OLD.verified AND NOT NEW.verified OR NOT NEW.phases @> OLD.phases THEN RAISE EXCEPTION 'Session original phase proof cannot be replaced';END IF;
  IF NEW.body IS DISTINCT FROM OLD.body AND NOT(phase='metadata' AND OLD.phases ? 'namespace' AND NEW.body=OLD.body||'{"taskKeys":[],"births":[],"compacted":true}'::jsonb) THEN
   RAISE EXCEPTION 'Session original scope cannot be replaced';END IF;
 ELSIF TG_OP='UPDATE' AND(NEW.generation<=OLD.generation OR phase<>'seal' OR NEW.phases<>'{}'::jsonb) THEN RAISE EXCEPTION 'Session renewed scope requires a later original seal';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_project_deletion_guard BEFORE INSERT OR UPDATE OR DELETE ON session.project_deletions FOR EACH ROW EXECUTE FUNCTION session.guard_deletion();
DO $$ DECLARE table_name text;BEGIN
 FOREACH table_name IN ARRAY ARRAY['runner_events','connections','business_executions','business_execution_events','business_stopped_executions','execution_completion_proofs','business_usage_sources','business_usage_events','development_usage_streams','development_usage_events'] LOOP
  EXECUTE format('CREATE TRIGGER session_content_guard BEFORE INSERT OR UPDATE OR DELETE ON session.%I FOR EACH ROW EXECUTE FUNCTION session.guard_content()',table_name);
  EXECUTE format('CREATE TRIGGER session_content_truncate BEFORE TRUNCATE ON session.%I FOR EACH STATEMENT EXECUTE FUNCTION session.reject_truncate()',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['task_origins','connection_births','project_deletions'] LOOP
  EXECUTE format('CREATE TRIGGER session_original_truncate BEFORE TRUNCATE ON session.%I FOR EACH STATEMENT EXECUTE FUNCTION session.reject_truncate()',table_name);
 END LOOP;
END $$;
