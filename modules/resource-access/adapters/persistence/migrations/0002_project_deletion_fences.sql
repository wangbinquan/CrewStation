CREATE TABLE resource_access.deletion_fences(project_id text PRIMARY KEY,operation_id text,generation integer NOT NULL DEFAULT 0,confirmed_revision text,scope_verified boolean NOT NULL DEFAULT false);
CREATE TABLE resource_access.deletion_identities(id text PRIMARY KEY,project_id text NOT NULL);
INSERT INTO resource_access.deletion_identities SELECT id,project_id FROM resource_access.changes;
-- 回调结束前始终保持 running；连接或队列租约消失不等于外部副作用已结束。
CREATE TABLE resource_access.deletion_work(change_id text PRIMARY KEY,project_id text NOT NULL,backend_pid integer,state text NOT NULL DEFAULT 'finished' CHECK(state IN ('running','finished')),generation integer NOT NULL DEFAULT 0,recovery_digest text CHECK(recovery_digest IS NULL OR recovery_digest~'^[a-f0-9]{64}$'));

CREATE FUNCTION resource_access.actual_shared_admission(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('crewstation.shared_admission_key',true)='resource-access.project-admission:' || target
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock'
      AND pid=coalesce(nullif(current_setting('crewstation.shared_admission_pid',true),''),'0')::integer
      AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
      AND classid::bigint=((hashtextextended('resource-access.project-admission:' || target,0) >> 32) & 4294967295)
      AND objid::bigint=(hashtextextended('resource-access.project-admission:' || target,0) & 4294967295))
$$;
CREATE FUNCTION resource_access.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids text[];target text;original_owner text;deletion_id text;internal_delete boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN ids:=array_append(ids,OLD.project_id); END IF;
  IF TG_OP<>'DELETE' THEN ids:=array_append(ids,NEW.project_id); END IF;
  FOR target IN SELECT DISTINCT value FROM unnest(ids) AS value WHERE value IS NOT NULL ORDER BY value LOOP
    IF NOT coalesce(resource_access.actual_shared_admission(target),false) THEN
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('resource-access.project-admission:' || target,0));
    END IF;
    SELECT operation_id INTO deletion_id FROM resource_access.deletion_fences WHERE project_id=target;
    internal_delete:=TG_OP='DELETE' AND deletion_id IS NOT NULL AND deletion_id=current_setting('crewstation.resource_access_deletion',true);
    IF deletion_id IS NOT NULL AND NOT coalesce(internal_delete,false) THEN
      RAISE EXCEPTION 'project resource requests are sealed for deletion' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  INSERT INTO resource_access.deletion_identities VALUES(NEW.id,NEW.project_id) ON CONFLICT DO NOTHING;
  SELECT project_id INTO original_owner FROM resource_access.deletion_identities WHERE id=NEW.id;
  IF original_owner IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'resource request identity ownership is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_access_project_content_fence BEFORE INSERT OR UPDATE OR DELETE ON resource_access.changes FOR EACH ROW EXECUTE FUNCTION resource_access.guard_project_content();

CREATE FUNCTION resource_access.guard_application_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;deletion_id text;original_owner text;exiting boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT operation_id INTO deletion_id FROM resource_access.deletion_fences WHERE project_id=OLD.project_id;
    IF OLD.state<>'finished' OR deletion_id IS NULL OR deletion_id IS DISTINCT FROM current_setting('crewstation.resource_access_deletion',true) THEN
      RAISE EXCEPTION 'resource application work cleanup requires finished proof' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  SELECT project_id INTO original_owner FROM resource_access.deletion_identities WHERE id=NEW.change_id;
  IF original_owner IS DISTINCT FROM NEW.project_id OR (TG_OP='UPDATE' AND (OLD.change_id IS DISTINCT FROM NEW.change_id OR OLD.project_id IS DISTINCT FROM NEW.project_id)) THEN
    RAISE EXCEPTION 'resource application work ownership is immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND NEW.state='finished' THEN
    exiting:=current_setting('crewstation.resource_access_work_exit',true)=OLD.change_id || ':' || OLD.generation || ':' || OLD.backend_pid
      AND NEW.backend_pid IS NOT DISTINCT FROM OLD.backend_pid AND NEW.generation=OLD.generation;
    IF NOT coalesce(exiting,false) THEN RAISE EXCEPTION 'resource application exit requires original proof' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  target:=NEW.project_id;
  IF NOT coalesce(resource_access.actual_shared_admission(target),false) THEN
    RAISE EXCEPTION 'resource application requires actual admission' USING ERRCODE='55000';
  END IF;
  SELECT operation_id INTO deletion_id FROM resource_access.deletion_fences WHERE project_id=target;
  IF deletion_id IS NOT NULL THEN RAISE EXCEPTION 'project resource requests are sealed for deletion' USING ERRCODE='55000'; END IF;
  IF NEW.state='running' AND (NEW.backend_pid IS NULL OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true)
    OR (TG_OP='UPDATE' AND (OLD.state<>'finished' OR NEW.generation<>OLD.generation+1))) THEN
    RAISE EXCEPTION 'resource application original admission does not match' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_access_application_work_fence BEFORE INSERT OR UPDATE OR DELETE ON resource_access.deletion_work FOR EACH ROW EXECUTE FUNCTION resource_access.guard_application_work();
