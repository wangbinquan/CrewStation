-- RFC-042 moved restore refusals to named application prechecks. RFC-044 retains those
-- semantics and serializes only the new migration reservation with concurrent grants.
DROP FUNCTION data.guard_production_binding_generation();
CREATE FUNCTION data.guard_migration_production_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE migration text;
BEGIN
 IF NEW.mode<>'development' AND NEW.state IN ('requested','approved','active') THEN
  SELECT migration_operation_id INTO migration FROM data.database_environment_bindings WHERE service_id=NEW.service_id AND env='production' FOR UPDATE;
  IF migration IS NOT NULL THEN RAISE EXCEPTION 'database_migration_active'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER migration_production_access BEFORE INSERT OR UPDATE ON data.task_bindings FOR EACH ROW EXECUTE FUNCTION data.guard_migration_production_access();
