-- RFC-034: independent physical closure for an unbound original admission; no numeric backfill.
ALTER TABLE dev_session.development_agent_endings ADD COLUMN prestart_closure jsonb;
-- The original locked migration restricts stage to the three numeric phases.
-- Extend its owner-local constraint here; preserve every old phase and all existing rows.
ALTER TABLE dev_session.development_agent_endings
  DROP CONSTRAINT development_agent_endings_stage_check,
  ADD CONSTRAINT development_agent_endings_stage_check
    CHECK (stage IN ('awaiting-stop','awaiting-closure','evidence-complete','prestart-closed'));
