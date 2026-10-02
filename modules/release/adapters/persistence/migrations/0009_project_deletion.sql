CREATE TABLE release.deletion_fences (
  project_id text PRIMARY KEY, operation_id text NOT NULL, generation integer NOT NULL CHECK(generation>0), revision text NOT NULL,
  original jsonb NOT NULL, scope_verified boolean NOT NULL, phase_index integer NOT NULL DEFAULT -1, receipts jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE release.project_admissions(project_id text PRIMARY KEY,sealed boolean NOT NULL DEFAULT false);
CREATE TABLE release.deletion_entities(kind text NOT NULL,entity_key text NOT NULL,project_id text NOT NULL,PRIMARY KEY(kind,entity_key,project_id));
CREATE TABLE release.deletion_callbacks (
  id text PRIMARY KEY,kind text NOT NULL,consumer_id text NOT NULL,project_id text NOT NULL,service_id text NOT NULL,
  backend_pid integer NOT NULL,original_process jsonb NOT NULL,input_digest text NOT NULL,exit_key_hash text NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),exited_at timestamptz,exit_digest text,recovery_digest text,
  CHECK((exited_at IS NULL)=(exit_digest IS NULL))
);
CREATE INDEX release_deletion_callbacks_projects ON release.deletion_callbacks(project_id);
CREATE INDEX release_deletion_entities_projects ON release.deletion_entities(project_id);
CREATE FUNCTION release.deletion_json_text(body jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;BEGIN
 IF jsonb_typeof(body)='object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||release.deletion_json_text(item),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(body) AS entry(key,item);
 ELSIF jsonb_typeof(body)='array' THEN SELECT '['||COALESCE(string_agg(release.deletion_json_text(item),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(body) WITH ORDINALITY AS entry(item,ordinal);
 ELSE result:=body::text;END IF;RETURN result;
END $$;
CREATE FUNCTION release.deletion_hash(body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(release.deletion_json_text(body),'UTF8')),'hex') $$;
CREATE FUNCTION release.callback_receipt(body jsonb,recovery text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT release.deletion_hash(jsonb_build_object('id',body->'id','kind',body->'kind','consumerId',body->'consumer_id','projectId',body->'project_id','serviceId',body->'service_id','backendPid',body->'backend_pid','process',body->'original_process','inputDigest',body->'input_digest','exitKeyDigest',body->'exit_key_hash')||CASE WHEN recovery IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('recoveryDigest',recovery) END)
$$;
CREATE FUNCTION release.deletion_locked(project text,lock_mode text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND mode=lock_mode AND classid=((hashtextextended('release.project-admission:'||project,0)>>32)&4294967295)::oid AND objid=(hashtextextended('release.project-admission:'||project,0)&4294967295)::oid AND objsubid=1)
$$;
CREATE FUNCTION release.deletion_admitted(project text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE original_pid integer;keys jsonb;lock_key bigint:=hashtextextended('release.project-admission:'||project,0);BEGIN
 BEGIN original_pid:=NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;keys:=NULLIF(current_setting('crewstation.shared_admission_keys',true),'')::jsonb;EXCEPTION WHEN OTHERS THEN RETURN false;END;
 IF original_pid IS NULL OR keys IS NULL OR NOT keys ? ('release.project-admission:'||project) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=original_pid AND granted AND mode='ShareLock' AND classid=((lock_key>>32)&4294967295)::oid AND objid=(lock_key&4294967295)::oid AND objsubid=1);
END $$;
CREATE FUNCTION release.deletion_control_owner(project text,phase text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT release.deletion_locked(project,'ExclusiveLock') AND EXISTS(SELECT 1 FROM release.deletion_fences WHERE project_id=project AND scope_verified AND current_setting('crewstation.release_deletion_owner',true)=operation_id||':'||generation||':'||phase AND phase_index=CASE phase WHEN 'stop' THEN 0 WHEN 'metadata' THEN 4 ELSE -2 END)
$$;
CREATE FUNCTION release.deletion_refs(body jsonb,keys text[]) RETURNS SETOF text LANGUAGE sql IMMUTABLE AS $$
 WITH RECURSIVE nodes(field,value) AS (
   SELECT NULL::text,body UNION ALL SELECT to_jsonb(child)->>'field',to_jsonb(child)->'value' FROM nodes CROSS JOIN LATERAL (
    SELECT key AS field,value FROM jsonb_each(CASE WHEN jsonb_typeof((to_jsonb(nodes)->'value'))='object' THEN (to_jsonb(nodes)->'value') ELSE '{}'::jsonb END)
    UNION ALL SELECT NULL::text,value FROM jsonb_array_elements(CASE WHEN jsonb_typeof((to_jsonb(nodes)->'value'))='array' THEN (to_jsonb(nodes)->'value') ELSE '[]'::jsonb END)
   ) AS child
 ) SELECT DISTINCT value#>>'{}' FROM nodes WHERE field=ANY(keys) AND jsonb_typeof(value)='string' AND value#>>'{}'<>''
$$;
CREATE FUNCTION release.deletion_key(kind text,body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN kind='replica_overrides' THEN release.deletion_json_text(jsonb_build_array(body->'service_id',body->'physical')) ELSE COALESCE(body->>'id',body->>'service_id') END
$$;
CREATE FUNCTION release.deletion_canonical(kind text,original_key text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT id FROM release.resource_identity_aliases WHERE to_jsonb(resource_identity_aliases)->>'kind'=$1 AND key=release.deletion_json_text(jsonb_build_array(original_key))),
   (SELECT DISTINCT link->>'id' FROM release.deletion_fences CROSS JOIN LATERAL jsonb_array_elements(original->'content'->'identityLinks') AS link WHERE link->>'kind'=$1 AND link->'keys'=jsonb_build_array(original_key)),original_key)
$$;
CREATE FUNCTION release.deletion_projects(kind text,body jsonb) RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
DECLARE resolved_identity text;original_key text;BEGIN
 IF body IS NULL THEN RETURN;END IF;
 FOR original_key IN SELECT release.deletion_refs(body,ARRAY['project_id','projectId']) LOOP RETURN NEXT release.deletion_canonical('project',original_key);END LOOP;
 FOR original_key IN SELECT release.deletion_refs(body,ARRAY['service_id','serviceId']) LOOP
  resolved_identity:=release.deletion_canonical('service',original_key);
  RETURN QUERY SELECT release.deletion_canonical('project',project_id) FROM (
    SELECT DISTINCT project_id FROM release.releases WHERE service_id IN (
      SELECT resolved_identity UNION SELECT original_key
      UNION SELECT key::jsonb->>0 FROM release.resource_identity_aliases WHERE to_jsonb(resource_identity_aliases)->>'kind'='service' AND id=resolved_identity AND jsonb_array_length(key::jsonb)=1
      UNION SELECT link->'keys'->>0 FROM release.deletion_fences CROSS JOIN LATERAL jsonb_array_elements(original->'content'->'identityLinks') AS link WHERE link->>'kind'='service' AND link->>'id'=resolved_identity AND jsonb_array_length(link->'keys')=1
    )
  ) AS owned;
  RETURN QUERY SELECT project_id FROM release.deletion_fences WHERE original->'target'->>'serviceId'=resolved_identity OR EXISTS(SELECT 1 FROM jsonb_array_elements(original->'content'->'consumers') AS consumer WHERE consumer->>'serviceId'=resolved_identity)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(original->'content'->'identityLinks') AS link WHERE link->>'kind'='service' AND link->'keys'=jsonb_build_array(original_key));
  RETURN QUERY SELECT project_id FROM release.deletion_callbacks WHERE service_id=resolved_identity;
  RETURN QUERY SELECT project_id FROM release.deletion_entities WHERE to_jsonb(deletion_entities)->>'kind'='service' AND entity_key IN(resolved_identity,original_key);
 END LOOP;
 FOR original_key IN SELECT release.deletion_refs(body,ARRAY['release_id','releaseId','previous_release_id','previousReleaseId','targetReleaseId','expectedActiveReleaseId']) LOOP
  resolved_identity:=release.deletion_canonical('release',original_key);
  RETURN QUERY SELECT release.deletion_canonical('project',project_id) FROM release.releases WHERE id=resolved_identity OR legacy_resource_id=original_key;
  RETURN QUERY SELECT project_id FROM release.deletion_fences WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(original->'content'->'consumers') AS consumer WHERE consumer->>'kind'='release' AND (consumer->>'id'=resolved_identity OR consumer->'aliases' ? original_key));
  RETURN QUERY SELECT project_id FROM release.deletion_entities WHERE to_jsonb(deletion_entities)->>'kind'='release' AND entity_key IN(resolved_identity,original_key);
 END LOOP;
 RETURN QUERY SELECT project_id FROM release.deletion_entities WHERE to_jsonb(deletion_entities)->>'kind'=$1 AND entity_key=release.deletion_key($1,body);
END $$;
CREATE FUNCTION release.assert_project_write(project text,mode text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE previous_timeout text:=current_setting('lock_timeout');permanently_sealed boolean;BEGIN
 IF project IS NULL OR project !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Release original project identity is invalid' USING ERRCODE='55000';END IF;
 IF mode='DELETE' AND release.deletion_control_owner(project,'metadata') THEN RETURN;END IF;
 IF NOT release.deletion_admitted(project) THEN PERFORM set_config('lock_timeout','1s',true);PERFORM pg_advisory_xact_lock_shared(hashtextextended('release.project-admission:'||project,0));PERFORM set_config('lock_timeout',previous_timeout,true);END IF;
 INSERT INTO release.project_admissions(project_id,sealed) VALUES(project,false) ON CONFLICT(project_id) DO UPDATE SET sealed=release.project_admissions.sealed RETURNING sealed INTO permanently_sealed;
 IF permanently_sealed OR EXISTS(SELECT 1 FROM release.deletion_fences WHERE project_id=project) THEN RAISE EXCEPTION 'Release project admission is permanently sealed' USING ERRCODE='55000';END IF;
END $$;
CREATE FUNCTION release.content_birth(kind text,body jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN kind='releases' THEN (SELECT jsonb_object_agg(key,value) FROM jsonb_each(body) WHERE key=ANY(ARRAY['id','service_id','project_id','legacy_resource_id','tag','commit_sha','branch','created_by','created_at']))
 WHEN kind='slot_maintenance' THEN jsonb_build_object('operation',body->'body'->'operation','legacy',body->'legacy_body')
 WHEN kind='execution_handoffs' THEN jsonb_build_object('requestKey',body->'request_key','original',(SELECT jsonb_object_agg(key,value) FROM jsonb_each(body->'body') WHERE key=ANY(ARRAY['id','serviceId','projectId','requestKey','targetReleaseId','expectedActiveReleaseId','targetSlot','actorUserId','reason','createdAt'])))
 ELSE '{}'::jsonb END
$$;
CREATE FUNCTION release.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;project text;BEGIN
 IF TG_OP<>'INSERT' THEN before_body:=to_jsonb(OLD);END IF;IF TG_OP<>'DELETE' THEN after_body:=to_jsonb(NEW);END IF;
 IF TG_OP='UPDATE' AND (release.deletion_key(TG_TABLE_NAME,before_body) IS DISTINCT FROM release.deletion_key(TG_TABLE_NAME,after_body) OR before_body->'service_id' IS DISTINCT FROM after_body->'service_id' OR before_body->'project_id' IS DISTINCT FROM after_body->'project_id' OR before_body->'legacy_resource_id' IS DISTINCT FROM after_body->'legacy_resource_id' OR release.content_birth(TG_TABLE_NAME,before_body) IS DISTINCT FROM release.content_birth(TG_TABLE_NAME,after_body)) THEN RAISE EXCEPTION 'Release content original identity is immutable' USING ERRCODE='55000';END IF;
 FOR project IN SELECT DISTINCT value FROM (SELECT release.deletion_projects(TG_TABLE_NAME,before_body) AS value UNION ALL SELECT release.deletion_projects(TG_TABLE_NAME,after_body) AS value) AS projects ORDER BY value LOOP PERFORM release.assert_project_write(project,TG_OP);END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $$;
CREATE FUNCTION release.seal_project_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO release.project_admissions(project_id,sealed) VALUES(NEW.project_id,true) ON CONFLICT(project_id) DO UPDATE SET sealed=true;RETURN NEW;END $$;
CREATE TRIGGER release_permanent_fence AFTER INSERT OR UPDATE ON release.deletion_fences FOR EACH ROW EXECUTE FUNCTION release.seal_project_admission();
CREATE FUNCTION release.guard_project_controls() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project text:=COALESCE(to_jsonb(NEW),to_jsonb(OLD))->>'project_id';owner_context text:=current_setting('crewstation.release_deletion_owner',true);phase text;BEGIN
 IF TG_OP='DELETE' OR project IS NULL OR project !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Release deletion control cannot be removed or unbound' USING ERRCODE='55000';END IF;
 IF TG_OP='UPDATE' AND OLD.project_id<>NEW.project_id THEN RAISE EXCEPTION 'Release control project is immutable' USING ERRCODE='55000';END IF;
 IF TG_TABLE_NAME='project_admissions' THEN
  IF TG_OP='UPDATE' AND OLD.sealed AND NOT NEW.sealed THEN RAISE EXCEPTION 'Release project admission is permanently sealed' USING ERRCODE='55000';END IF;
  IF TG_OP='UPDATE' AND OLD.sealed=NEW.sealed AND (release.deletion_locked(project,'ShareLock') OR release.deletion_admitted(project)) THEN RETURN NEW;END IF;
  IF NEW.sealed THEN IF NOT release.deletion_locked(project,'ExclusiveLock') OR NOT EXISTS(SELECT 1 FROM release.deletion_fences WHERE project_id=project AND owner_context LIKE operation_id||':'||generation||':%') THEN RAISE EXCEPTION 'Release seal requires original owner' USING ERRCODE='55000';END IF;
  ELSIF NOT(release.deletion_locked(project,'ShareLock') OR release.deletion_admitted(project)) THEN RAISE EXCEPTION 'Release admission requires real shared lock' USING ERRCODE='55000';END IF;RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='deletion_entities' THEN IF TG_OP<>'INSERT' OR NOT release.deletion_control_owner(project,'metadata') THEN RAISE EXCEPTION 'Release tombstone requires metadata owner' USING ERRCODE='55000';END IF;RETURN NEW;END IF;
 IF NOT release.deletion_locked(project,'ExclusiveLock') THEN RAISE EXCEPTION 'Release fence requires real exclusive lock' USING ERRCODE='55000';END IF;
 IF TG_OP='INSERT' OR NEW.generation<>OLD.generation THEN
  IF owner_context IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':seal' OR NEW.phase_index<>-1 OR NEW.receipts<>'{}'::jsonb OR NEW.original->'target'->>'projectId' IS DISTINCT FROM project THEN RAISE EXCEPTION 'Release original seal is unbound' USING ERRCODE='55000';END IF;
  IF TG_OP='UPDATE' AND(NEW.operation_id<>OLD.operation_id OR NEW.generation<=OLD.generation OR OLD.phase_index>=5 OR NEW.original->'target' IS DISTINCT FROM OLD.original->'target' OR OLD.original->'physical' IS NOT NULL AND OLD.original->'physical'<>'null'::jsonb AND NEW.original->'physical' IS DISTINCT FROM OLD.original->'physical') THEN RAISE EXCEPTION 'Release generation cannot replace original physical scope' USING ERRCODE='55000';END IF;
  IF NEW.scope_verified AND(NEW.original->'inventory'->>'revision' IS DISTINCT FROM NEW.revision OR NEW.original->'inventory'->>'complete' IS DISTINCT FROM 'true' OR NEW.original->'inventory'->>'participant' IS DISTINCT FROM 'release') THEN RAISE EXCEPTION 'Release seal lacks original confirmed inventory' USING ERRCODE='55000';END IF;RETURN NEW;
 END IF;
 phase:=(ARRAY['seal','stop','purge','prove','namespace','metadata','verify'])[NEW.phase_index+1];
 IF to_jsonb(OLD)-ARRAY['phase_index','receipts'] IS DISTINCT FROM to_jsonb(NEW)-ARRAY['phase_index','receipts'] OR NEW.phase_index<>OLD.phase_index+1 OR phase IS NULL OR owner_context IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase OR NEW.receipts-phase IS DISTINCT FROM OLD.receipts OR jsonb_typeof(NEW.receipts->phase) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Release phase cannot skip or rewrite original receipts' USING ERRCODE='55000';END IF;RETURN NEW;
END $$;
CREATE FUNCTION release.callback_birth_valid(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE resource_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';original jsonb:=body->'original_process';BEGIN
 IF jsonb_typeof(original) IS DISTINCT FROM 'object' OR NOT original ?& ARRAY['podUid','nodeUid','containerId','nodeName','pid','pidNamespace','bootId','startTicks'] OR original-ARRAY['podUid','nodeUid','containerId','nodeName','pid','pidNamespace','bootId','startTicks']<>'{}'::jsonb THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(original) AS field WHERE CASE WHEN to_jsonb(field)->>'key'='pid' THEN jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'number' ELSE jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'string' END) THEN RETURN false;END IF;
 RETURN body->>'id' ~ resource_pattern AND body->>'consumer_id' ~ resource_pattern AND body->>'project_id' ~ resource_pattern AND body->>'service_id' ~ resource_pattern AND(body->>'backend_pid')::integer>0 AND body->>'input_digest' ~ '^[a-f0-9]{64}$' AND body->>'exit_key_hash' ~ '^[a-f0-9]{64}$' AND original->>'podUid' ~ uuid_pattern AND original->>'nodeUid' ~ uuid_pattern AND original->>'bootId' ~ uuid_pattern AND original->>'containerId' ~ '^[a-z0-9]+://[a-f0-9]{64}$' AND length(original->>'nodeName') BETWEEN 1 AND 253 AND(original->>'pid')::integer>0 AND original->>'pidNamespace' ~ '^[0-9]+$' AND original->>'startTicks' ~ '^[0-9]+$';
EXCEPTION WHEN OTHERS THEN RETURN false;END $$;
CREATE FUNCTION release.guard_project_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb;after_body jsonb;callback_key text:=current_setting('crewstation.release_callback_exit',true);BEGIN
 IF TG_OP<>'INSERT' THEN before_body:=to_jsonb(OLD);END IF;IF TG_OP<>'DELETE' THEN after_body:=to_jsonb(NEW);END IF;
 IF TG_OP='INSERT' THEN
  IF release.callback_birth_valid(after_body) IS DISTINCT FROM true OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL OR NEW.kind NOT IN('publish','pipeline','slot','maintenance','handoff','sweep','ledger') OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) OR NOT release.deletion_admitted(NEW.project_id) THEN RAISE EXCEPTION 'Release callback requires original admitted birth' USING ERRCODE='55000';END IF;
  PERFORM release.assert_project_write(NEW.project_id,'INSERT');
  IF EXISTS(SELECT 1 FROM release.deletion_entities WHERE kind='deletion_callbacks' AND entity_key=NEW.id) THEN RAISE EXCEPTION 'Release callback cannot be recreated' USING ERRCODE='55000';END IF;RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN IF OLD.exited_at IS NULL OR OLD.exit_digest IS DISTINCT FROM release.callback_receipt(before_body,OLD.recovery_digest) OR NOT release.deletion_control_owner(OLD.project_id,'metadata') THEN RAISE EXCEPTION 'Release callback deletion requires original exit and metadata owner' USING ERRCODE='55000';END IF;RETURN OLD;END IF;
 IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL OR NEW.exit_digest IS DISTINCT FROM release.callback_receipt(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Release callback original birth and exit are immutable' USING ERRCODE='55000';END IF;
 IF NEW.recovery_digest IS NULL THEN IF callback_key IS NULL OR release.deletion_hash(to_jsonb(callback_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Release callback exit requires original private key' USING ERRCODE='55000';END IF;
 ELSIF NOT release.deletion_control_owner(OLD.project_id,'stop') THEN RAISE EXCEPTION 'Release callback recovery requires original stop owner' USING ERRCODE='55000';END IF;RETURN NEW;
END $$;
CREATE FUNCTION release.guard_identity_aliases() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project text;BEGIN
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN RAISE EXCEPTION 'Release original identity aliases are immutable' USING ERRCODE='55000';END IF;
 IF TG_OP='INSERT' AND NEW.kind IN('project','service','release') THEN FOR project IN SELECT release.deletion_projects('resource_identity_aliases',jsonb_build_object(NEW.kind||'Id',NEW.id)) LOOP PERFORM release.assert_project_write(project,'INSERT');END LOOP;END IF;
 RETURN NEW;END $$;
CREATE TRIGGER release_identity_alias_guard BEFORE INSERT OR UPDATE OR DELETE ON release.resource_identity_aliases FOR EACH ROW EXECUTE FUNCTION release.guard_identity_aliases();
CREATE FUNCTION release.reject_content_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Release content cannot bypass project admission with TRUNCATE' USING ERRCODE='55000';END $$;
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['releases','service_slots','traffic_switches','replica_overrides','slot_maintenance','slot_events','execution_handoffs'] LOOP
  EXECUTE format('CREATE TRIGGER release_project_content_guard BEFORE INSERT OR UPDATE OR DELETE ON release.%I FOR EACH ROW EXECUTE FUNCTION release.guard_project_content()',name);
  EXECUTE format('CREATE TRIGGER release_project_truncate_guard BEFORE TRUNCATE ON release.%I FOR EACH STATEMENT EXECUTE FUNCTION release.reject_content_truncate()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['deletion_fences','deletion_entities','project_admissions'] LOOP EXECUTE format('CREATE TRIGGER release_project_control_guard BEFORE INSERT OR UPDATE OR DELETE ON release.%I FOR EACH ROW EXECUTE FUNCTION release.guard_project_controls()',name);END LOOP;
 CREATE TRIGGER release_project_callback_guard BEFORE INSERT OR UPDATE OR DELETE ON release.deletion_callbacks FOR EACH ROW EXECUTE FUNCTION release.guard_project_callbacks();
 FOREACH name IN ARRAY ARRAY['deletion_fences','deletion_entities','project_admissions','deletion_callbacks','resource_identity_aliases'] LOOP EXECUTE format('CREATE TRIGGER release_project_truncate_guard BEFORE TRUNCATE ON release.%I FOR EACH STATEMENT EXECUTE FUNCTION release.reject_content_truncate()',name);END LOOP;
END $$;
