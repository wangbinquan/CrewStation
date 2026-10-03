-- 原 0007 和其历史映射保持；不改写旧实体，也不回填未知归属。
CREATE FUNCTION api_catalog.reject_original_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'API catalog original identity is immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER api_catalog_original_identity_guard BEFORE UPDATE OR DELETE ON api_catalog.deletion_entities FOR EACH ROW EXECUTE FUNCTION api_catalog.reject_original_identity_mutation();
CREATE TRIGGER api_catalog_original_identity_truncate_guard BEFORE TRUNCATE ON api_catalog.deletion_entities FOR EACH STATEMENT EXECUTE FUNCTION api_catalog.reject_original_identity_mutation();
