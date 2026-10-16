CREATE TABLE gateway.database_restore_maintenance (
 operation_id text PRIMARY KEY, service_id text NOT NULL, project_id text NOT NULL,
 original jsonb, maintenance_revision integer NOT NULL, completed boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX database_restore_maintenance_active ON gateway.database_restore_maintenance(service_id) WHERE NOT completed;
CREATE TRIGGER gateway_restore_project_guard BEFORE INSERT OR UPDATE OR DELETE ON gateway.database_restore_maintenance FOR EACH ROW EXECUTE FUNCTION gateway.guard_project_content();
CREATE FUNCTION gateway.guard_restore_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; operation text;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.service_id ELSE NEW.service_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended('gateway.maintenance:'||target,0));
 SELECT operation_id INTO operation FROM gateway.database_restore_maintenance WHERE service_id=target AND NOT completed;
 IF operation IS NOT NULL AND operation IS DISTINCT FROM nullif(current_setting('crewstation.restore_maintenance',true),'') THEN RAISE EXCEPTION 'database_restore_maintenance_held'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER gateway_restore_maintenance_guard BEFORE INSERT OR UPDATE OR DELETE ON gateway.service_maintenance FOR EACH ROW EXECUTE FUNCTION gateway.guard_restore_maintenance();

CREATE OR REPLACE FUNCTION gateway.content_owner(content_table text,body jsonb) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE content_table
 WHEN 'database_restore_maintenance' THEN body->>'project_id'
 WHEN 'service_maintenance' THEN body->>'project_id'
 WHEN 'rate_limit_receipts' THEN body->>'project_id'
 WHEN 'rate_limits' THEN CASE WHEN body->>'scope'<>'platform' THEN body->>'scope' END
 WHEN 'pod_identities' THEN (SELECT project_id FROM gateway.deletion_entities WHERE kind='pod' AND entity_key=gateway.pod_key(body))
 ELSE (SELECT project_id FROM gateway.deletion_entities WHERE kind='service' AND entity_key=body->>'service_id') END
$$;

CREATE FUNCTION gateway.guard_restore_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.operation_id,NEW.service_id,NEW.project_id,NEW.original,NEW.maintenance_revision) IS DISTINCT FROM (OLD.operation_id,OLD.service_id,OLD.project_id,OLD.original,OLD.maintenance_revision) THEN RAISE EXCEPTION 'restore maintenance identity is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.completed AND NOT NEW.completed THEN RAISE EXCEPTION 'restore maintenance completion is irreversible'; END IF;
 IF TG_OP='DELETE' AND NOT OLD.completed THEN RAISE EXCEPTION 'active restore maintenance cannot be removed'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER gateway_restore_hold_identity BEFORE UPDATE OR DELETE ON gateway.database_restore_maintenance FOR EACH ROW EXECUTE FUNCTION gateway.guard_restore_hold();
CREATE FUNCTION gateway.reject_restore_hold_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'restore maintenance must be removed through its original owner'; END $$;
CREATE TRIGGER gateway_restore_hold_truncate BEFORE TRUNCATE ON gateway.database_restore_maintenance FOR EACH STATEMENT EXECUTE FUNCTION gateway.reject_restore_hold_truncate();
