-- Explicit administrative history operations. Original accepted prices remain immutable.
CREATE TABLE observability.runtime_maintenance(id text PRIMARY KEY,request_key text UNIQUE NOT NULL,actor_id text NOT NULL,document jsonb NOT NULL,lease_id text,lease_until timestamptz,confirmed_order bigint);
CREATE SEQUENCE observability.runtime_maintenance_confirmation_sequence;
CREATE TABLE observability.runtime_maintenance_members(operation_id text NOT NULL REFERENCES observability.runtime_maintenance(id),task_id text NOT NULL,project_id text NOT NULL,task_key text NOT NULL,through bigint NOT NULL,header jsonb NOT NULL,state text NOT NULL DEFAULT 'pending',cursor text,error text,version text,row_through numeric,PRIMARY KEY(operation_id,task_id));
CREATE TABLE observability.runtime_maintenance_rows(operation_id text NOT NULL REFERENCES observability.runtime_maintenance(id),task_id text NOT NULL,project_id text NOT NULL,task_key text NOT NULL,key text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(operation_id,task_id,key));
CREATE TABLE observability.execution_price_corrections(execution_id text NOT NULL,generation integer NOT NULL,project_id text NOT NULL,task_id text NOT NULL,task_key text NOT NULL,revision bigint NOT NULL DEFAULT 1,document jsonb NOT NULL,PRIMARY KEY(execution_id,generation));
CREATE TABLE observability.execution_price_correction_audit(operation_id text NOT NULL,execution_id text NOT NULL,generation integer NOT NULL,project_id text NOT NULL,task_id text NOT NULL,task_key text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(operation_id,execution_id,generation));
CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.runtime_maintenance_members FOR EACH ROW EXECUTE FUNCTION observability.guard_content();
CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.runtime_maintenance_rows FOR EACH ROW EXECUTE FUNCTION observability.guard_content();
CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.execution_price_corrections FOR EACH ROW EXECUTE FUNCTION observability.guard_content();
CREATE TRIGGER observation_content_guard BEFORE INSERT OR UPDATE OR DELETE ON observability.execution_price_correction_audit FOR EACH ROW EXECUTE FUNCTION observability.guard_content();

CREATE FUNCTION observability.guard_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF OLD.document IS DISTINCT FROM NEW.document THEN RAISE EXCEPTION 'Original correction audit is immutable';END IF;RETURN NEW;END $$;
CREATE TRIGGER correction_audit_immutable BEFORE UPDATE ON observability.execution_price_correction_audit FOR EACH ROW EXECUTE FUNCTION observability.guard_correction_audit();
