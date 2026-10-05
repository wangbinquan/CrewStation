-- Original release callbacks exclude native registry reclamation, including disconnected callbacks.
CREATE FUNCTION release.native_registry_admitted() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE admitted text:=current_setting('crewstation.shared_admission_pid',true); key_hash bigint:=hashtextextended('storage.registry-admission',0);
BEGIN
  IF admitted IS NULL OR admitted !~ '^[1-9][0-9]*$' THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock' AND pid=admitted::integer
    AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND classid=((key_hash>>32)&4294967295)::oid AND objid=(key_hash&4294967295)::oid AND objsubid=1);
END $$;

CREATE FUNCTION release.guard_native_registry_callback() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT release.native_registry_admitted() THEN RAISE EXCEPTION 'Registry release callback requires real global admission' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER release_native_registry_callback_guard BEFORE INSERT ON release.deletion_callbacks
  FOR EACH ROW EXECUTE FUNCTION release.guard_native_registry_callback();
