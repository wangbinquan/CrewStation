-- Keep the locked initial migration intact; JSONB extraction must precede array subtraction.
CREATE OR REPLACE FUNCTION release.guard_database_restore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.project_id,NEW.service_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.project_id,OLD.service_id,OLD.created_at)
  OR (NEW.body-ARRAY['revision','stage','updatedAt','restoreJob','verifyJob','verification','restoreProof','verifyProof','switchActor','maintenanceRevision','maintenanceWasOpen','environmentBox','environmentVersion','candidateProof','error','restoreJobId','verifyJobId','previousAttempts'])
  IS DISTINCT FROM (OLD.body-ARRAY['revision','stage','updatedAt','restoreJob','verifyJob','verification','restoreProof','verifyProof','switchActor','maintenanceRevision','maintenanceWasOpen','environmentBox','environmentVersion','candidateProof','error','restoreJobId','verifyJobId','previousAttempts'])) THEN
  RAISE EXCEPTION 'database restore original input is immutable';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.body->>'restoreJobId',NEW.body->>'verifyJobId') IS DISTINCT FROM (OLD.body->>'restoreJobId',OLD.body->>'verifyJobId') THEN
  IF OLD.stage NOT IN ('restoring','verifying') OR NEW.stage<>OLD.stage OR NEW.body->>'error' IS NOT NULL
    OR jsonb_array_length(NEW.body->'previousAttempts')<>jsonb_array_length(OLD.body->'previousAttempts')+1
    OR (NEW.body->'previousAttempts')-(jsonb_array_length(NEW.body->'previousAttempts')-1) IS DISTINCT FROM OLD.body->'previousAttempts'
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
