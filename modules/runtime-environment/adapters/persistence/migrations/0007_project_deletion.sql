CREATE TABLE runtime_environment.deletion_fences (
  project_id text PRIMARY KEY, operation_id text NOT NULL, generation integer NOT NULL CHECK (generation > 0),
  revision text NOT NULL, original jsonb NOT NULL, scope_verified boolean NOT NULL,
  phase_index integer NOT NULL DEFAULT -1, receipts jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE runtime_environment.deletion_entities (
  kind text NOT NULL, entity_key text NOT NULL, project_id text NOT NULL,
  PRIMARY KEY (kind,entity_key,project_id)
);
CREATE TABLE runtime_environment.project_admissions (
  project_id text PRIMARY KEY, sealed boolean NOT NULL DEFAULT false
);
CREATE TABLE runtime_environment.deletion_callbacks (
  id text PRIMARY KEY, kind text NOT NULL, consumer_id text NOT NULL, project_ids jsonb NOT NULL, original_project_ids jsonb NOT NULL,
  backend_pid integer NOT NULL, callback_pid integer NOT NULL, callback_started_at text NOT NULL,
  original_process jsonb NOT NULL, input_digest text NOT NULL, exit_key_hash text NOT NULL CHECK(exit_key_hash ~ '^[a-f0-9]{64}$'), entered_at timestamptz NOT NULL DEFAULT now(),
  exited_at timestamptz, exit_digest text, recovery_digest text,
  CHECK (jsonb_typeof(project_ids)='array'), CHECK (jsonb_typeof(original_project_ids)='array'), CHECK ((exited_at IS NULL)=(exit_digest IS NULL))
);
CREATE INDEX runtime_deletion_callbacks_projects ON runtime_environment.deletion_callbacks USING gin(project_ids);
CREATE INDEX runtime_deletion_entities_projects ON runtime_environment.deletion_entities(project_id);

-- Platform versions keep only immutable catalog provenance, never the project's build execution payload.
CREATE TABLE runtime_environment.build_provenance (
  id text PRIMARY KEY, image_id text NOT NULL REFERENCES runtime_environment.images(id),
  revision_id text NOT NULL REFERENCES runtime_environment.revisions(id)
);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM runtime_environment.versions AS version JOIN runtime_environment.builds AS build ON to_jsonb(version)->>'build_id'=to_jsonb(build)->>'id'
    WHERE to_jsonb(version)->'payload'->>'buildId' IS DISTINCT FROM to_jsonb(build)->>'id'
      OR to_jsonb(version)->>'image_id' IS DISTINCT FROM to_jsonb(build)->>'image_id'
      OR to_jsonb(version)->'payload'->>'imageId' IS DISTINCT FROM to_jsonb(version)->>'image_id'
      OR to_jsonb(version)->'payload'->>'revisionId' IS DISTINCT FROM to_jsonb(build)->'payload'->>'revisionId'
      OR NOT EXISTS(SELECT 1 FROM runtime_environment.revisions AS recipe_row WHERE to_jsonb(recipe_row)->>'id'=to_jsonb(build)->'payload'->>'revisionId' AND to_jsonb(recipe_row)->>'image_id'=to_jsonb(build)->>'image_id')) THEN
    RAISE EXCEPTION 'Runtime image stored version provenance mismatches original build' USING ERRCODE='55000';
  END IF;
END $$;
INSERT INTO runtime_environment.build_provenance(id,image_id,revision_id)
  SELECT to_jsonb(build)->>'id',to_jsonb(build)->>'image_id',to_jsonb(build)->'payload'->>'revisionId' FROM runtime_environment.builds AS build
    WHERE EXISTS(SELECT 1 FROM runtime_environment.versions AS version WHERE to_jsonb(version)->>'build_id'=to_jsonb(build)->>'id');
ALTER TABLE runtime_environment.versions DROP CONSTRAINT versions_build_id_fkey;
ALTER TABLE runtime_environment.versions ADD CONSTRAINT versions_build_provenance_fkey FOREIGN KEY(build_id) REFERENCES runtime_environment.build_provenance(id);

CREATE FUNCTION runtime_environment.retain_build_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_body jsonb;
BEGIN
  SELECT to_jsonb(builds) INTO original_body FROM runtime_environment.builds WHERE id=NEW.build_id;
  IF original_body IS NULL OR NEW.payload->>'buildId' IS DISTINCT FROM NEW.build_id OR NEW.payload->>'imageId' IS DISTINCT FROM NEW.image_id
    OR original_body->>'image_id' IS DISTINCT FROM NEW.image_id OR original_body->'payload'->>'revisionId' IS DISTINCT FROM NEW.payload->>'revisionId'
    OR NOT EXISTS(SELECT 1 FROM runtime_environment.revisions WHERE id=NEW.payload->>'revisionId' AND image_id=NEW.image_id) THEN
    RAISE EXCEPTION 'Runtime image version requires original build provenance' USING ERRCODE='55000';
  END IF;
  INSERT INTO runtime_environment.build_provenance(id,image_id,revision_id) VALUES(NEW.build_id,NEW.image_id,NEW.payload->>'revisionId') ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM runtime_environment.build_provenance WHERE id=NEW.build_id AND image_id=NEW.image_id AND revision_id=NEW.payload->>'revisionId') THEN
    RAISE EXCEPTION 'Runtime image original build provenance is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_build_provenance BEFORE INSERT ON runtime_environment.versions FOR EACH ROW EXECUTE FUNCTION runtime_environment.retain_build_provenance();
CREATE FUNCTION runtime_environment.guard_build_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' OR pg_trigger_depth()<>2 THEN RAISE EXCEPTION 'Runtime image minimal provenance can only come from original version insertion' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_build_provenance_guard BEFORE INSERT OR UPDATE OR DELETE ON runtime_environment.build_provenance FOR EACH ROW EXECUTE FUNCTION runtime_environment.guard_build_provenance();

CREATE FUNCTION runtime_environment.deletion_key(kind text, body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN kind='creation_requests' THEN encode(sha256(convert_to(jsonb_build_array(body->>'request_scope',body->>'actor_id',body->>'request_key')::text,'UTF8')),'hex')
    WHEN kind='image_project_grants' THEN encode(sha256(convert_to(jsonb_build_array(body->>'image_id',body->>'project_id')::text,'UTF8')),'hex')
    ELSE COALESCE(body->>'id',body->>'operation_id',body->>'sequence',body->>'project_id') END
$$;

-- Version state belongs to the platform. Only creating a version reads its original build's project dependencies.
CREATE FUNCTION runtime_environment.deletion_projects(kind text, body jsonb, mode text) RETURNS SETOF text LANGUAGE plpgsql STABLE AS $$
DECLARE value jsonb := COALESCE(body->'payload','{}'::jsonb); revision_body jsonb; build_body jsonb;
BEGIN
  IF kind IN ('references','development_policies','project_image_policies','image_project_grants','allocation_receipts','builds') THEN
    RETURN QUERY SELECT body->>'project_id' WHERE NULLIF(body->>'project_id','') IS NOT NULL;
  END IF;
  IF kind IN ('references','development_policies','project_image_policies','validations','builds') THEN
    RETURN QUERY SELECT value->>'projectId' WHERE NULLIF(value->>'projectId','') IS NOT NULL;
  END IF;
  IF kind='creation_requests' AND body->>'request_scope'<>'platform' THEN RETURN NEXT body->>'request_scope'; END IF;
  IF kind='revisions' THEN
    RETURN QUERY SELECT value->>'sourceProjectId' WHERE NULLIF(value->>'sourceProjectId','') IS NOT NULL;
    RETURN QUERY SELECT value->>'initializerProjectId' WHERE NULLIF(value->>'initializerProjectId','') IS NOT NULL;
  ELSIF kind='builds' THEN
    RETURN QUERY SELECT value->>'sourceProjectId' WHERE NULLIF(value->>'sourceProjectId','') IS NOT NULL;
    RETURN QUERY SELECT value->'resourcePlan'->>'projectId' WHERE NULLIF(value->'resourcePlan'->>'projectId','') IS NOT NULL;
    SELECT payload INTO revision_body FROM runtime_environment.revisions WHERE id=value->>'revisionId';
    RETURN QUERY SELECT revision_body->>'sourceProjectId' WHERE NULLIF(revision_body->>'sourceProjectId','') IS NOT NULL;
    RETURN QUERY SELECT revision_body->>'initializerProjectId' WHERE NULLIF(revision_body->>'initializerProjectId','') IS NOT NULL;
  ELSIF kind='build_logs' OR kind='versions' AND mode='INSERT' THEN
    SELECT to_jsonb(builds) INTO build_body FROM runtime_environment.builds WHERE id=body->>'build_id';
    IF build_body IS NOT NULL THEN RETURN QUERY SELECT * FROM runtime_environment.deletion_projects('builds',build_body,mode); END IF;
    RETURN QUERY SELECT project_id FROM runtime_environment.deletion_entities WHERE to_jsonb(deletion_entities)->>'kind'='builds' AND entity_key=body->>'build_id';
  END IF;
  RETURN QUERY SELECT project_id FROM runtime_environment.deletion_entities WHERE to_jsonb(deletion_entities)->>'kind'=$1 AND entity_key=runtime_environment.deletion_key($1,body);
END $$;

CREATE FUNCTION runtime_environment.deletion_admitted(project text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE lock_key bigint := hashtextextended('runtime-environment.project-admission:'||project,0);
  original_pid integer; keys jsonb;
BEGIN
  BEGIN
    original_pid := NULLIF(current_setting('crewstation.shared_admission_pid',true),'')::integer;
    keys := NULLIF(current_setting('crewstation.shared_admission_keys',true),'')::jsonb;
  EXCEPTION WHEN OTHERS THEN RETURN false; END;
  IF original_pid IS NULL OR keys IS NULL OR NOT keys ? ('runtime-environment.project-admission:'||project) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=original_pid AND granted AND mode='ShareLock'
    AND classid=((lock_key >> 32) & 4294967295)::oid AND objid=(lock_key & 4294967295)::oid AND objsubid=1);
END $$;

CREATE FUNCTION runtime_environment.deletion_owner(project text, write_mode text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE lock_key bigint := hashtextextended('runtime-environment.project-admission:'||project,0);
  owner_context text := current_setting('crewstation.runtime_deletion_owner',true);
BEGIN
  IF write_mode<>'DELETE' OR owner_context IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM runtime_environment.deletion_fences
    WHERE project_id=project AND scope_verified AND phase_index=4 AND owner_context=operation_id||':'||generation||':metadata')
    AND EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND mode='ExclusiveLock'
      AND classid=((lock_key >> 32) & 4294967295)::oid AND objid=(lock_key & 4294967295)::oid AND objsubid=1);
END $$;

CREATE FUNCTION runtime_environment.assert_project_write(project text, mode text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE previous_timeout text := current_setting('lock_timeout'); permanently_sealed boolean;
BEGIN
  IF project IS NULL OR project !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Runtime image project ownership is missing or invalid' USING ERRCODE='55000';
  END IF;
  IF runtime_environment.deletion_owner(project,mode) THEN RETURN; END IF;
  -- An in-flight original callback already holds a shared lock. Taking a second queued lock would deadlock its seal.
  IF NOT runtime_environment.deletion_admitted(project) THEN
    PERFORM set_config('lock_timeout','1s',true);
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('runtime-environment.project-admission:'||project,0));
    PERFORM set_config('lock_timeout',previous_timeout,true);
  END IF;
  -- Updating the persistent admission row also rejects a stale repeatable-read snapshot after seal.
  INSERT INTO runtime_environment.project_admissions(project_id) VALUES(project)
    ON CONFLICT(project_id) DO UPDATE SET project_id=project RETURNING sealed INTO permanently_sealed;
  IF permanently_sealed OR EXISTS (SELECT 1 FROM runtime_environment.deletion_fences WHERE project_id=project) THEN
    RAISE EXCEPTION 'Runtime image project admission is permanently sealed' USING ERRCODE='55000';
  END IF;
END $$;

CREATE FUNCTION runtime_environment.seal_project_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO runtime_environment.project_admissions(project_id,sealed) VALUES(NEW.project_id,true)
    ON CONFLICT(project_id) DO UPDATE SET sealed=true;
  RETURN NEW;
END $$;
CREATE TRIGGER runtime_project_permanent_fence AFTER INSERT OR UPDATE ON runtime_environment.deletion_fences
  FOR EACH ROW EXECUTE FUNCTION runtime_environment.seal_project_admission();

CREATE FUNCTION runtime_environment.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb; after_body jsonb; project text; old_payload jsonb; new_payload jsonb; identity_fields text[];
BEGIN
  IF TG_OP<>'INSERT' THEN before_body:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN after_body:=to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME='validations' AND COALESCE(after_body,before_body)->'payload'->>'projectId' IS NULL
    OR TG_TABLE_NAME='creation_requests' AND COALESCE(after_body,before_body)->>'request_scope' IS NULL THEN
    RAISE EXCEPTION 'Runtime image project ownership is missing or invalid' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' THEN
    old_payload:=before_body->'payload'; new_payload:=after_body->'payload';
    IF runtime_environment.deletion_key(TG_TABLE_NAME,before_body) IS DISTINCT FROM runtime_environment.deletion_key(TG_TABLE_NAME,after_body) THEN
      RAISE EXCEPTION 'Runtime image content identity is immutable' USING ERRCODE='55000';
    END IF;
    IF TG_TABLE_NAME='builds' THEN identity_fields:=ARRAY['id','imageId','revisionId','projectId','sourceProjectId'];
    ELSIF TG_TABLE_NAME='validations' THEN identity_fields:=ARRAY['id','projectId','versionId','contractDigest','target'];
    ELSIF TG_TABLE_NAME='revisions' THEN identity_fields:=ARRAY['id','imageId','sourceProjectId','initializerProjectId','source','initializer'];
    ELSIF TG_TABLE_NAME='references' THEN identity_fields:=ARRAY['id','projectId','versionId','ownerType','ownerId','snapshot'];
    ELSIF TG_TABLE_NAME='versions' THEN identity_fields:=ARRAY['id','imageId','revisionId','buildId','repository','digest']; END IF;
    IF EXISTS (SELECT 1 FROM unnest(identity_fields) AS field WHERE old_payload->field IS DISTINCT FROM new_payload->field)
      OR before_body->'project_id' IS DISTINCT FROM after_body->'project_id'
      OR before_body->'image_id' IS DISTINCT FROM after_body->'image_id'
      OR before_body->'version_id' IS DISTINCT FROM after_body->'version_id'
      OR before_body->'build_id' IS DISTINCT FROM after_body->'build_id'
      OR before_body->'owner_id' IS DISTINCT FROM after_body->'owner_id'
      OR before_body->'owner_type' IS DISTINCT FROM after_body->'owner_type' THEN
      RAISE EXCEPTION 'Runtime image project or source identity is immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  FOR project IN SELECT DISTINCT value FROM (
    SELECT runtime_environment.deletion_projects(TG_TABLE_NAME,before_body,TG_OP) AS value WHERE before_body IS NOT NULL
    UNION ALL SELECT runtime_environment.deletion_projects(TG_TABLE_NAME,after_body,TG_OP) AS value WHERE after_body IS NOT NULL
  ) AS projects ORDER BY value LOOP
    PERFORM runtime_environment.assert_project_write(project,TG_OP);
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE FUNCTION runtime_environment.reject_content_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Runtime image content cannot bypass project admission with TRUNCATE' USING ERRCODE='55000'; END $$;

CREATE FUNCTION runtime_environment.deletion_locked(project text, lock_mode text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted AND mode=lock_mode
    AND classid=((hashtextextended('runtime-environment.project-admission:'||project,0) >> 32) & 4294967295)::oid
    AND objid=(hashtextextended('runtime-environment.project-admission:'||project,0) & 4294967295)::oid AND objsubid=1)
$$;
CREATE FUNCTION runtime_environment.deletion_control_owner(project text, phase text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT runtime_environment.deletion_locked(project,'ExclusiveLock') AND EXISTS(SELECT 1 FROM runtime_environment.deletion_fences
    WHERE project_id=project AND scope_verified AND current_setting('crewstation.runtime_deletion_owner',true)=operation_id||':'||generation||':'||phase
      AND phase_index=CASE phase WHEN 'stop' THEN 0 WHEN 'metadata' THEN 4 ELSE -2 END)
$$;

-- Canonical JSON matches the callback's JS jsonHash; no application exit key is stored in plaintext.
CREATE FUNCTION runtime_environment.deletion_json_text(body jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text;
BEGIN
  IF jsonb_typeof(body)='object' THEN
    SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||runtime_environment.deletion_json_text(item),',' ORDER BY key COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(body) AS entry(key,item);
  ELSIF jsonb_typeof(body)='array' THEN
    SELECT '['||COALESCE(string_agg(runtime_environment.deletion_json_text(item),',' ORDER BY ordinal),'')||']'
      INTO result FROM jsonb_array_elements(body) WITH ORDINALITY AS entry(item,ordinal);
  ELSE result:=body::text; END IF;
  RETURN result;
END $$;
CREATE FUNCTION runtime_environment.deletion_hash(body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(runtime_environment.deletion_json_text(body),'UTF8')),'hex')
$$;
CREATE FUNCTION runtime_environment.callback_receipt(body jsonb, recovery text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT runtime_environment.deletion_hash(jsonb_build_object('id',body->'id','kind',body->'kind','consumerId',body->'consumer_id','inputDigest',body->'input_digest',
    'projectIds',body->'original_project_ids','backendPid',body->'backend_pid','callbackPid',body->'callback_pid','callbackStartedAt',body->'callback_started_at',
    'originalProcess',body->'original_process','exitKeyDigest',body->'exit_key_hash')||CASE WHEN recovery IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('recoveryDigest',recovery) END)
$$;

CREATE FUNCTION runtime_environment.guard_project_controls() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE project text:=COALESCE(to_jsonb(NEW),to_jsonb(OLD))->>'project_id'; owner_context text:=current_setting('crewstation.runtime_deletion_owner',true);
  phase text; old_body jsonb; new_body jsonb; admitted boolean;
BEGIN
  IF TG_OP='DELETE' OR project IS NULL OR project !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Runtime image deletion control cannot be removed or unbound' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND OLD.project_id<>NEW.project_id THEN RAISE EXCEPTION 'Runtime image control project is immutable' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='project_admissions' THEN
    admitted:=runtime_environment.deletion_locked(project,'ShareLock') OR runtime_environment.deletion_admitted(project);
    IF TG_OP='UPDATE' AND OLD.sealed AND NOT NEW.sealed THEN RAISE EXCEPTION 'Runtime image project admission is permanently sealed' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND OLD.sealed=NEW.sealed AND admitted THEN RETURN NEW; END IF;
    IF NEW.sealed THEN
      IF NOT runtime_environment.deletion_locked(project,'ExclusiveLock') OR NOT EXISTS(SELECT 1 FROM runtime_environment.deletion_fences
        WHERE project_id=project AND owner_context LIKE operation_id||':'||generation||':%') THEN RAISE EXCEPTION 'Runtime image sealing requires original owner' USING ERRCODE='55000'; END IF;
    ELSIF NOT admitted THEN RAISE EXCEPTION 'Runtime image admission requires actual shared lock' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='deletion_entities' THEN
    IF TG_OP<>'INSERT' OR NOT runtime_environment.deletion_control_owner(project,'metadata') THEN RAISE EXCEPTION 'Runtime image entity tombstone requires metadata owner' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF NOT runtime_environment.deletion_locked(project,'ExclusiveLock') THEN RAISE EXCEPTION 'Runtime image original fence requires actual exclusive lock' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' OR NEW.generation<>OLD.generation THEN
    IF owner_context IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':seal' OR NEW.phase_index<>-1 OR NEW.receipts<>'{}'::jsonb
      OR NEW.original->'target'->>'projectId' IS DISTINCT FROM project THEN RAISE EXCEPTION 'Runtime image original seal binding is invalid' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND (NEW.operation_id<>OLD.operation_id OR NEW.generation<=OLD.generation OR OLD.phase_index>=5
      OR NEW.original->'target' IS DISTINCT FROM OLD.original->'target'
      OR OLD.original->'physical' IS NOT NULL AND OLD.original->'physical'<>'null'::jsonb AND NEW.original->'physical' IS DISTINCT FROM OLD.original->'physical') THEN
      RAISE EXCEPTION 'Runtime image generation cannot replace original physical scope' USING ERRCODE='55000';
    END IF;
    IF NEW.scope_verified AND (NEW.original->'inventory'->>'revision' IS DISTINCT FROM NEW.revision OR NEW.original->'inventory'->>'complete' IS DISTINCT FROM 'true'
      OR NEW.original->'inventory'->>'participant' IS DISTINCT FROM 'runtime-environment') THEN RAISE EXCEPTION 'Runtime image verified seal lacks original inventory' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  old_body:=to_jsonb(OLD)-ARRAY['phase_index','receipts'];new_body:=to_jsonb(NEW)-ARRAY['phase_index','receipts'];
  phase:=(ARRAY['seal','stop','purge','prove','namespace','metadata','verify'])[NEW.phase_index+1];
  IF old_body IS DISTINCT FROM new_body OR NEW.phase_index<>OLD.phase_index+1 OR phase IS NULL
    OR owner_context IS DISTINCT FROM NEW.operation_id||':'||NEW.generation||':'||phase OR NEW.receipts-phase IS DISTINCT FROM OLD.receipts
    OR jsonb_typeof(NEW.receipts->phase) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Runtime image phase cannot skip or rewrite original receipts' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION runtime_environment.callback_birth_valid(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE resource_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  uuid_pattern text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  original jsonb:=body->'original_process'; projects jsonb:=body->'original_project_ids'; ordered jsonb;
BEGIN
  IF jsonb_typeof(original) IS DISTINCT FROM 'object' OR jsonb_typeof(projects) IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  IF body->>'id' !~ resource_pattern OR body->>'consumer_id' !~ resource_pattern
    OR (body->>'backend_pid')::integer<=0 OR (body->>'callback_pid')::integer<=0
    OR body->>'input_digest' !~ '^[a-f0-9]{64}$' OR body->>'exit_key_hash' !~ '^[a-f0-9]{64}$'
    OR body->>'callback_started_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$'
    OR original->>'podUid' !~ uuid_pattern OR original->>'nodeUid' !~ uuid_pattern
    OR original->>'containerId' !~ '^[a-z0-9]+://[a-f0-9]{64}$' OR length(original->>'nodeName') NOT BETWEEN 1 AND 253
    OR original-ARRAY['podUid','nodeUid','containerId','nodeName']<>'{}'::jsonb
    OR EXISTS(SELECT 1 FROM jsonb_each(original) AS field WHERE jsonb_typeof(to_jsonb(field)->'value') IS DISTINCT FROM 'string')
    OR NOT original ?& ARRAY['podUid','nodeUid','containerId','nodeName'] THEN RETURN false;END IF;
  PERFORM (body->>'callback_started_at')::timestamptz;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(projects) AS item WHERE jsonb_typeof(item) IS DISTINCT FROM 'string' OR item#>>'{}' !~ resource_pattern) THEN RETURN false;END IF;
  SELECT jsonb_agg(project ORDER BY project COLLATE "C") INTO ordered FROM (SELECT DISTINCT jsonb_array_elements_text(projects) AS project) AS project_set;
  RETURN projects=ordered AND jsonb_array_length(projects)>0;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION runtime_environment.guard_project_callbacks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_body jsonb; after_body jsonb; project text; owner_exit boolean; callback_key text:=current_setting('crewstation.runtime_callback_exit',true);
BEGIN
  IF TG_OP<>'INSERT' THEN before_body:=to_jsonb(OLD);END IF;
  IF TG_OP<>'DELETE' THEN after_body:=to_jsonb(NEW);END IF;
  IF TG_OP='INSERT' THEN
    IF runtime_environment.callback_birth_valid(after_body) IS DISTINCT FROM true
      OR NEW.project_ids<>NEW.original_project_ids OR jsonb_array_length(NEW.project_ids)=0 OR NEW.exited_at IS NOT NULL OR NEW.exit_digest IS NOT NULL OR NEW.recovery_digest IS NOT NULL
      OR NEW.kind NOT IN ('build','validation','source','initializer') OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) THEN
      RAISE EXCEPTION 'Runtime image callback requires original admitted birth' USING ERRCODE='55000';
    END IF;
    FOR project IN SELECT jsonb_array_elements_text(NEW.project_ids) ORDER BY 1 LOOP
      IF NOT runtime_environment.deletion_admitted(project) THEN RAISE EXCEPTION 'Runtime image callback requires real original shared locks' USING ERRCODE='55000'; END IF;
      PERFORM runtime_environment.assert_project_write(project,'INSERT');
    END LOOP;
    IF EXISTS(SELECT 1 FROM runtime_environment.deletion_entities WHERE kind='deletion_callbacks' AND entity_key=NEW.id) THEN RAISE EXCEPTION 'Runtime image original callback cannot be recreated' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR NEW.project_ids IS DISTINCT FROM OLD.project_ids THEN
    IF OLD.exited_at IS NULL OR OLD.exit_digest IS DISTINCT FROM runtime_environment.callback_receipt(before_body,OLD.recovery_digest) THEN RAISE EXCEPTION 'Runtime image original callback has not exited' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND (before_body-'project_ids' IS DISTINCT FROM after_body-'project_ids' OR NOT OLD.project_ids @> NEW.project_ids OR jsonb_array_length(NEW.project_ids)=0 OR jsonb_array_length(NEW.project_ids)>=jsonb_array_length(OLD.project_ids)) THEN
      RAISE EXCEPTION 'Runtime image callback membership can only shrink without replacing birth' USING ERRCODE='55000';
    END IF;
    FOR project IN SELECT jsonb_array_elements_text(OLD.project_ids) EXCEPT SELECT jsonb_array_elements_text(CASE WHEN TG_OP='DELETE' THEN '[]'::jsonb ELSE NEW.project_ids END) LOOP
      IF NOT runtime_environment.deletion_control_owner(project,'metadata') THEN RAISE EXCEPTION 'Runtime image callback removal requires original metadata owner' USING ERRCODE='55000'; END IF;
    END LOOP;
    IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
  END IF;
  IF before_body-ARRAY['exited_at','exit_digest','recovery_digest'] IS DISTINCT FROM after_body-ARRAY['exited_at','exit_digest','recovery_digest'] OR OLD.exited_at IS NOT NULL OR NEW.exited_at IS NULL
    OR NEW.exit_digest IS DISTINCT FROM runtime_environment.callback_receipt(before_body,NEW.recovery_digest) THEN RAISE EXCEPTION 'Runtime image callback birth and exit are immutable' USING ERRCODE='55000'; END IF;
  IF NEW.recovery_digest IS NULL THEN
    IF callback_key IS NULL OR runtime_environment.deletion_hash(to_jsonb(callback_key)) IS DISTINCT FROM OLD.exit_key_hash THEN RAISE EXCEPTION 'Runtime image callback exit requires original private key' USING ERRCODE='55000'; END IF;
  ELSE
    SELECT bool_or(runtime_environment.deletion_control_owner(value,'stop')) INTO owner_exit FROM jsonb_array_elements_text(OLD.project_ids) AS entry(value);
    IF NOT COALESCE(owner_exit,false) THEN RAISE EXCEPTION 'Runtime image callback recovery requires original stop owner' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['revisions','builds','versions','validations','references','build_logs','development_policies','creation_requests','project_image_policies','image_project_grants','allocation_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER runtime_project_content_guard BEFORE INSERT OR UPDATE OR DELETE ON runtime_environment.%I FOR EACH ROW EXECUTE FUNCTION runtime_environment.guard_project_content()',name);
    EXECUTE format('CREATE TRIGGER runtime_project_truncate_guard BEFORE TRUNCATE ON runtime_environment.%I FOR EACH STATEMENT EXECUTE FUNCTION runtime_environment.reject_content_truncate()',name);
  END LOOP;
END $$;

DO $$ DECLARE name text;BEGIN
  FOREACH name IN ARRAY ARRAY['deletion_fences','deletion_entities','project_admissions'] LOOP
    EXECUTE format('CREATE TRIGGER runtime_project_control_guard BEFORE INSERT OR UPDATE OR DELETE ON runtime_environment.%I FOR EACH ROW EXECUTE FUNCTION runtime_environment.guard_project_controls()',name);
  END LOOP;
  CREATE TRIGGER runtime_project_callback_guard BEFORE INSERT OR UPDATE OR DELETE ON runtime_environment.deletion_callbacks FOR EACH ROW EXECUTE FUNCTION runtime_environment.guard_project_callbacks();
  FOREACH name IN ARRAY ARRAY['deletion_fences','deletion_entities','project_admissions','deletion_callbacks','build_provenance'] LOOP
    EXECUTE format('CREATE TRIGGER runtime_project_truncate_guard BEFORE TRUNCATE ON runtime_environment.%I FOR EACH STATEMENT EXECUTE FUNCTION runtime_environment.reject_content_truncate()',name);
  END LOOP;
END $$;
