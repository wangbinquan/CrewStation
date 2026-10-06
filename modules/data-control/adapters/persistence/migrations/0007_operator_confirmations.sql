CREATE TABLE data_control.operator_confirmations (
 context_id text NOT NULL,
 item_key text NOT NULL,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN('retain','reclaim')),
 actor_id text NOT NULL,
 confirmed_at timestamptz NOT NULL,
 value jsonb NOT NULL CHECK(value->>'version'='operator-confirmed/v1'),
 PRIMARY KEY(context_id,item_key,source_digest,evidence_digest)
);
CREATE FUNCTION data_control.guard_operator_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE admission text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'operator confirmation is immutable' USING ERRCODE='55000'; END IF;
 admission:='data-control.project-admission:' || NEW.context_id;
 IF current_setting('crewstation.operator_confirmation',true) IS DISTINCT FROM
   NEW.context_id || ':' || NEW.source_digest || ':' || NEW.evidence_digest || ':' || NEW.decision || ':' || NEW.actor_id
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ExclusiveLock'
     AND pid=pg_backend_pid() AND objsubid=1
     AND classid::bigint=((hashtextextended(admission,0) >> 32) & 4294967295)
     AND objid::bigint=(hashtextextended(admission,0) & 4294967295))
 THEN RAISE EXCEPTION 'operator confirmation requires actual original admission' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_operator_confirmation BEFORE INSERT OR UPDATE OR DELETE ON data_control.operator_confirmations
 FOR EACH ROW EXECUTE FUNCTION data_control.guard_operator_confirmation();
