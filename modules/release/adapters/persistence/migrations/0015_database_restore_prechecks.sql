-- RFC-042 review: cross-operation restore rules surfaced as HTTP 500 from triggers and blocked
-- unrelated slot maintenance; a second restore could never switch. Application prechecks now return
-- documented codes (database_restore_active, database_generation_retained), using the data binding
-- as the only source of the active generation.
DROP TRIGGER database_restore_slot ON release.service_slots;
DROP FUNCTION release.guard_restore_slot();
DROP TRIGGER database_restore_release ON release.releases;
DROP FUNCTION release.guard_restore_release();
-- An abandoned restore ends its reservation and keeps its record and target for inspection.
ALTER TABLE release.database_restores DROP CONSTRAINT database_restores_stage_check;
ALTER TABLE release.database_restores ADD CONSTRAINT database_restores_stage_check CHECK(stage IN ('requested','provisioning','restoring','verifying','ready-to-switch','freezing','deploying','switching','completed','abandoned'));
DROP INDEX release.database_restore_one_active;
CREATE UNIQUE INDEX database_restore_one_active ON release.database_restores(service_id) WHERE stage NOT IN ('completed','abandoned');
-- Original inputs stay immutable and attempt history append-only; any observed failure may open a new attempt.
CREATE OR REPLACE FUNCTION release.guard_database_restore() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable text[] := ARRAY['revision','stage','updatedAt','restoreJob','verifyJob','verification','restoreProof','verifyProof','switchActor','maintenanceRevision','maintenanceWasOpen','environmentBox','environmentVersion','candidateProof','error','observation','restoreJobId','verifyJobId','previousAttempts','switchCommitted','abandonedBy','abandonedAt'];
 kept integer;
BEGIN
 IF TG_OP<>'UPDATE' THEN RETURN NEW; END IF;
 IF (NEW.id,NEW.project_id,NEW.service_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.service_id,OLD.created_at) OR (NEW.body-mutable) IS DISTINCT FROM (OLD.body-mutable) THEN
  RAISE EXCEPTION 'database restore original input is immutable';
 END IF;
 IF NEW.revision<>OLD.revision+1 OR OLD.stage IN ('completed','abandoned') THEN RAISE EXCEPTION 'database restore revision or terminal state changed'; END IF;
 IF OLD.body->>'environmentBox' IS NOT NULL AND (NEW.body->>'environmentBox',NEW.body->>'environmentVersion') IS DISTINCT FROM (OLD.body->>'environmentBox',OLD.body->>'environmentVersion') THEN RAISE EXCEPTION 'restore environment is immutable'; END IF;
 kept := jsonb_array_length(OLD.body->'previousAttempts');
 IF jsonb_array_length(NEW.body->'previousAttempts')<kept OR COALESCE((SELECT jsonb_agg(item ORDER BY position) FROM jsonb_array_elements(NEW.body->'previousAttempts') WITH ORDINALITY AS attempts(item,position) WHERE position<=kept),'[]'::jsonb) IS DISTINCT FROM OLD.body->'previousAttempts' THEN
  RAISE EXCEPTION 'restore attempt history is append-only';
 END IF;
 RETURN NEW;
END $$;
