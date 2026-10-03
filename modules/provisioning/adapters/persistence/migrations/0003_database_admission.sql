-- Cluster-wide backend PID visibility must not let a lock from another database qualify an original local birth.
CREATE OR REPLACE FUNCTION provisioning.locked(project text,lock_mode text,backend integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=backend AND granted AND mode=lock_mode
 AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
 AND classid=((hashtextextended('provisioning.project-admission:'||project,0)>>32)&4294967295)::oid
 AND objid=(hashtextextended('provisioning.project-admission:'||project,0)&4294967295)::oid AND objsubid=1)
$$;
