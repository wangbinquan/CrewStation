-- 只保留原 PVC/PV/供应器位置和实际回收摘要，不保存卷数据或配置秘密。
CREATE TABLE resources.deletion_volume_receipts (
  project_id text NOT NULL, operation_id text NOT NULL, object_key text NOT NULL,
  pvc_uid text NOT NULL, pv_uid text NOT NULL, original_target jsonb NOT NULL,
  proof_digest text CHECK(proof_digest ~ '^[a-f0-9]{64}$'), observed_at timestamptz,
  PRIMARY KEY(project_id,operation_id,object_key), CHECK ((proof_digest IS NULL) = (observed_at IS NULL)),
  CHECK(pvc_uid = original_target->>'uid' AND pv_uid = original_target->>'pvUid')
);
CREATE FUNCTION resources.guard_deletion_volume_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.object_key IS DISTINCT FROM OLD.object_key
    OR NEW.pvc_uid IS DISTINCT FROM OLD.pvc_uid OR NEW.pv_uid IS DISTINCT FROM OLD.pv_uid
    OR NEW.original_target IS DISTINCT FROM OLD.original_target OR OLD.proof_digest IS NOT NULL)) THEN
    RAISE EXCEPTION 'original volume reclaim identity and proof are immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM resources.deletion_fences WHERE project_id = NEW.project_id
    AND operation_id = NEW.operation_id AND confirmed_revision IS NOT NULL AND retired = false)
    OR NEW.operation_id IS DISTINCT FROM current_setting('crewstation.resources_volume_reclaim',true) THEN
    RAISE EXCEPTION 'volume reclaim receipt requires an original deletion grant' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deletion_volume_receipt_immutable BEFORE INSERT OR UPDATE OR DELETE ON resources.deletion_volume_receipts
  FOR EACH ROW EXECUTE FUNCTION resources.guard_deletion_volume_receipt();
