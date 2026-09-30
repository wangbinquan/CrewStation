-- 最小物理停止审计；没有可恢复的 Pod 配置、容器内容或业务材料。
CREATE TABLE resources.deletion_stop_receipts (
  project_id text NOT NULL, operation_id text NOT NULL, object_key text NOT NULL, original_uid text NOT NULL,
  node_uid text, proof_digest text NOT NULL CHECK(proof_digest ~ '^[a-f0-9]{64}$'), observed_at timestamptz NOT NULL,
  PRIMARY KEY(project_id,operation_id,object_key)
);
CREATE FUNCTION resources.guard_deletion_stop_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'physical stop receipts are immutable' USING ERRCODE = '55000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM resources.deletion_fences WHERE project_id = NEW.project_id
    AND operation_id = NEW.operation_id AND confirmed_revision IS NOT NULL AND retired = false)
    OR NEW.operation_id IS DISTINCT FROM current_setting('crewstation.resources_stop_proof',true) THEN
    RAISE EXCEPTION 'physical stop receipt requires an original deletion grant' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deletion_stop_receipt_immutable BEFORE INSERT OR UPDATE OR DELETE ON resources.deletion_stop_receipts
  FOR EACH ROW EXECUTE FUNCTION resources.guard_deletion_stop_receipt();
