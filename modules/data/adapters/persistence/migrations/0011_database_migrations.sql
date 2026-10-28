ALTER TABLE data.database_generations DROP CONSTRAINT database_generations_origin_check;
ALTER TABLE data.database_generations ADD CONSTRAINT database_generations_origin_check CHECK(origin IN ('existing','restore','migration','migration-scratch'));
ALTER TABLE data.database_generations ADD COLUMN migration_operation_id text;
ALTER TABLE data.database_generations ADD CONSTRAINT migration_generation_origin CHECK((origin IN ('migration','migration-scratch'))=(migration_operation_id IS NOT NULL));
CREATE UNIQUE INDEX migration_generation_operation ON data.database_generations(migration_operation_id,origin) WHERE migration_operation_id IS NOT NULL;
ALTER TABLE data.database_environment_bindings ADD COLUMN migration_operation_id text;
ALTER TABLE data.database_environment_bindings ADD COLUMN last_migration_operation_id text;
ALTER TABLE data.database_environment_bindings ADD COLUMN migration_opened boolean NOT NULL DEFAULT false;
ALTER TABLE data.database_environment_bindings ADD COLUMN migration_reverted boolean NOT NULL DEFAULT false;
ALTER TABLE data.database_environment_bindings ADD CONSTRAINT one_database_operation CHECK(restore_operation_id IS NULL OR migration_operation_id IS NULL);
CREATE FUNCTION data.guard_migration_generation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='database_generations' THEN
  IF NEW.migration_operation_id IS DISTINCT FROM OLD.migration_operation_id THEN RAISE EXCEPTION 'migration generation birth is immutable'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM data.database_generations WHERE id=NEW.generation_id AND origin='migration-scratch') THEN RAISE EXCEPTION 'scratch generation cannot be bound'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER migration_generation_identity BEFORE UPDATE ON data.database_generations FOR EACH ROW EXECUTE FUNCTION data.guard_migration_generation();
CREATE TRIGGER migration_binding_target BEFORE INSERT OR UPDATE ON data.database_environment_bindings FOR EACH ROW EXECUTE FUNCTION data.guard_migration_generation();
-- A concurrent production grant serializes with both kinds of database reservation.
CREATE OR REPLACE FUNCTION data.guard_production_binding_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reservation text; migration text; active_name text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.database_name IS NOT NULL AND NEW.database_name IS DISTINCT FROM OLD.database_name THEN RAISE EXCEPTION 'production access target is immutable'; END IF;
 IF NEW.mode<>'development' AND NEW.state IN ('requested','approved','active') THEN
  SELECT b.restore_operation_id,b.migration_operation_id,g.object_name INTO reservation,migration,active_name FROM data.database_environment_bindings b JOIN data.database_generations g ON g.id=b.generation_id WHERE b.service_id=NEW.service_id AND b.env='production' FOR UPDATE OF b;
  IF migration IS NOT NULL THEN RAISE EXCEPTION 'database_migration_active'; END IF;
  IF reservation IS NOT NULL THEN RAISE EXCEPTION 'database_restore_active'; END IF;
  IF NEW.database_name IS NULL THEN NEW.database_name:=active_name; END IF;
  IF NEW.database_name IS DISTINCT FROM active_name THEN RAISE EXCEPTION 'production database generation changed'; END IF;
 END IF;
 RETURN NEW;
END $$;
