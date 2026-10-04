-- Append-only repair: the original guard named attemptId/incarnationId, while real receipts use attempt/incarnation.
CREATE FUNCTION session.guard_sealed_business_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM session.task_origins o JOIN session.project_deletions d ON d.project_id=o.project_id WHERE o.task_key=OLD.task_id)
  AND (OLD.task_id IS DISTINCT FROM NEW.task_id OR OLD.execution_id IS DISTINCT FROM NEW.execution_id
   OR OLD.receipt->'executionId' IS DISTINCT FROM NEW.receipt->'executionId'
   OR OLD.receipt->'attempt' IS DISTINCT FROM NEW.receipt->'attempt'
   OR OLD.receipt->'incarnation' IS DISTINCT FROM NEW.receipt->'incarnation'
   OR OLD.receipt->'payloadDigest' IS DISTINCT FROM NEW.receipt->'payloadDigest') THEN
  RAISE EXCEPTION 'Session original business binding cannot be replaced';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER session_business_origin_guard BEFORE UPDATE ON session.business_executions
 FOR EACH ROW EXECUTE FUNCTION session.guard_sealed_business_origin();
