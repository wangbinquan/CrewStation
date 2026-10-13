-- RFC-034: an original CLI negative capability is never numerical zero.
ALTER TABLE dev_session.development_agent_usage ADD COLUMN unsupported_proof jsonb;
CREATE FUNCTION dev_session.guard_cli_capability_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.unsupported_proof IS NOT NULL AND NEW.unsupported_proof IS DISTINCT FROM OLD.unsupported_proof THEN RAISE EXCEPTION 'original CLI capability proof is immutable';END IF;
 IF NEW.unsupported_proof IS NOT NULL AND (NOT NEW.unsupported OR NEW.binding IS NOT NULL OR NEW.capability_pod_uid IS NOT NULL OR NEW.prepared#>>'{intent,identity,sourceKind}'<>'development-cli') THEN RAISE EXCEPTION 'CLI negative capability cannot downgrade numeric admission';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cli_capability_original BEFORE UPDATE ON dev_session.development_agent_usage FOR EACH ROW EXECUTE FUNCTION dev_session.guard_cli_capability_original();
