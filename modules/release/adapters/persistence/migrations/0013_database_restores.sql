CREATE TABLE release.database_restores (
 id text PRIMARY KEY, project_id text NOT NULL, service_id text NOT NULL,
 stage text NOT NULL CHECK(stage IN ('requested','provisioning','restoring','verifying','ready-to-switch','freezing','deploying','switching','completed')),
 revision integer NOT NULL CHECK(revision>0), body jsonb NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX database_restore_one_active ON release.database_restores(service_id) WHERE stage<>'completed';
CREATE UNIQUE INDEX database_restore_job ON release.database_restores((body->>'restoreJobId'));
CREATE UNIQUE INDEX database_verify_job ON release.database_restores((body->>'verifyJobId'));
CREATE FUNCTION release.guard_database_restore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.project_id,NEW.service_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.service_id,OLD.created_at)
  OR (NEW.body-ARRAY['revision','stage','updatedAt','restoreJob','verifyJob','verification','restoreProof','verifyProof','switchActor','maintenanceRevision','maintenanceWasOpen','environmentBox','environmentVersion','candidateProof','error','restoreJobId','verifyJobId','previousAttempts'])
  IS DISTINCT FROM (OLD.body-ARRAY['revision','stage','updatedAt','restoreJob','verifyJob','verification','restoreProof','verifyProof','switchActor','maintenanceRevision','maintenanceWasOpen','environmentBox','environmentVersion','candidateProof','error','restoreJobId','verifyJobId','previousAttempts'])) THEN
  RAISE EXCEPTION 'database restore original input is immutable';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.body->>'restoreJobId',NEW.body->>'verifyJobId') IS DISTINCT FROM (OLD.body->>'restoreJobId',OLD.body->>'verifyJobId') THEN
  IF OLD.stage NOT IN ('restoring','verifying') OR NEW.stage<>OLD.stage OR NEW.body->>'error' IS NOT NULL
    OR jsonb_array_length(NEW.body->'previousAttempts')<>jsonb_array_length(OLD.body->'previousAttempts')+1
    OR NEW.body->'previousAttempts'-(jsonb_array_length(NEW.body->'previousAttempts')-1) IS DISTINCT FROM OLD.body->'previousAttempts'
    OR NOT (CASE WHEN OLD.stage='restoring' THEN
      OLD.body->'restoreProof'->'receipt'->>'state'='failed' AND NEW.body->'restoreProof'='null'::jsonb AND NEW.body->>'verifyJobId'=OLD.body->>'verifyJobId'
      AND NEW.body->'previousAttempts'->-1=jsonb_build_object('jobId',OLD.body->>'restoreJobId','purpose','database-restore','proof',OLD.body->'restoreProof')
    ELSE OLD.body->'verifyProof'->'receipt'->>'state'='failed' AND NEW.body->'verifyProof'='null'::jsonb AND NEW.body->>'restoreJobId'=OLD.body->>'restoreJobId'
      AND NEW.body->'previousAttempts'->-1=jsonb_build_object('jobId',OLD.body->>'verifyJobId','purpose','database-verify','proof',OLD.body->'verifyProof') END) THEN
      RAISE EXCEPTION 'restore retry requires original terminal failure and append-only attempt receipt';
  END IF;
 ELSIF TG_OP='UPDATE' AND NEW.body->'previousAttempts' IS DISTINCT FROM OLD.body->'previousAttempts' THEN RAISE EXCEPTION 'restore attempt history is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.body->>'environmentBox' IS NOT NULL AND (NEW.body->>'environmentBox',NEW.body->>'environmentVersion') IS DISTINCT FROM (OLD.body->>'environmentBox',OLD.body->>'environmentVersion') THEN RAISE EXCEPTION 'restore environment is immutable'; END IF;
 IF TG_OP='UPDATE' AND (NEW.revision<>OLD.revision+1 OR OLD.stage='completed') THEN RAISE EXCEPTION 'database restore revision or terminal state changed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER database_restore_identity BEFORE UPDATE ON release.database_restores FOR EACH ROW EXECUTE FUNCTION release.guard_database_restore();
CREATE TRIGGER release_project_content BEFORE INSERT OR UPDATE OR DELETE ON release.database_restores FOR EACH ROW EXECUTE FUNCTION release.guard_project_content();
CREATE TRIGGER release_project_truncate BEFORE TRUNCATE ON release.database_restores FOR EACH STATEMENT EXECUTE FUNCTION release.reject_content_truncate();

-- A reservation and every ordinary slot mutation share the service-slot row lock.
CREATE FUNCTION release.guard_restore_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation text; active_target text; active_id text; old_target text;
BEGIN
 SELECT id INTO operation FROM release.database_restores WHERE service_id=NEW.service_id AND stage<>'completed';
 IF operation IS NOT NULL AND operation IS DISTINCT FROM nullif(current_setting('crewstation.database_restore_operation',true),'') THEN
  RAISE EXCEPTION 'database_restore_active';
 END IF;
 -- A retained old slot cannot become active after a completed database cutover.
 IF TG_OP='UPDATE' AND NEW.active IS DISTINCT FROM OLD.active THEN
  SELECT body->>'candidateReleaseId',body->>'sourceReleaseId' INTO active_target,old_target FROM release.database_restores
   WHERE service_id=NEW.service_id AND stage='completed' ORDER BY created_at DESC LIMIT 1;
  active_id:=CASE WHEN NEW.active='blue' THEN NEW.blue->>'releaseId' ELSE NEW.green->>'releaseId' END;
  IF active_target IS NOT NULL AND (CASE WHEN NEW.active='blue' THEN NEW.blue ELSE NEW.green END)->'workload'->>'databaseGenerationId' IS DISTINCT FROM (SELECT body->>'targetGenerationId' FROM release.database_restores WHERE service_id=NEW.service_id AND stage='completed' ORDER BY created_at DESC LIMIT 1) THEN RAISE EXCEPTION 'retained database release requires explicit restore'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER database_restore_slot BEFORE UPDATE ON release.service_slots FOR EACH ROW EXECUTE FUNCTION release.guard_restore_slot();

CREATE FUNCTION release.guard_restore_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE operation text;
BEGIN
 PERFORM service_id FROM release.service_slots WHERE service_id=NEW.service_id FOR UPDATE;
 SELECT id INTO operation FROM release.database_restores WHERE service_id=NEW.service_id AND stage<>'completed';
 IF operation IS NOT NULL AND operation IS DISTINCT FROM nullif(current_setting('crewstation.database_restore_operation',true),'') THEN RAISE EXCEPTION 'database_restore_active'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER database_restore_release BEFORE INSERT OR UPDATE ON release.releases FOR EACH ROW EXECUTE FUNCTION release.guard_restore_release();
