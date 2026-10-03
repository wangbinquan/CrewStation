-- Keep only original ownership IDs after collector replacement or project content purge.
CREATE TABLE cluster_management.infrastructure_origins (
  kind text NOT NULL CHECK(kind IN ('cluster-refresh','cluster-operation','cluster-metrics','cluster-storage')),
  id text NOT NULL,
  material jsonb NOT NULL,
  PRIMARY KEY(kind,id),
  CHECK(material->>'scope' IN ('project','platform','unknown'))
);
CREATE FUNCTION cluster_management.operation_origin(body jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'scope',CASE body->'target'->'ownership'->>'scope' WHEN 'project' THEN 'project' WHEN 'system' THEN 'platform' ELSE 'unknown' END,
    'projectId',CASE WHEN body->'target'->'ownership'->>'scope'='project' THEN body->'target'->'ownership'->>'projectId' END,
    'component',CASE WHEN body->'target'->'ownership'->>'scope'='system' THEN body->'target'->'ownership'->>'component' END,
    'resourceId',body->'target'->>'resourceId','resourceUid',body->'target'->>'uid'))
$$;
-- These are actual owner rows, not queue-body guesses or fabricated missing history.
INSERT INTO cluster_management.infrastructure_origins SELECT 'cluster-refresh',id,'{"scope":"platform"}'::jsonb FROM cluster_management.refresh_history;
INSERT INTO cluster_management.infrastructure_origins SELECT 'cluster-'||kind,request_id,'{"scope":"platform"}'::jsonb
  FROM cluster_management.metric_collectors WHERE kind IN ('metrics','storage');
INSERT INTO cluster_management.infrastructure_origins SELECT 'cluster-operation',id,cluster_management.operation_origin(body) FROM cluster_management.operations;

CREATE FUNCTION cluster_management.guard_infrastructure_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Original cluster infrastructure ownership is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.kind='cluster-refresh' AND EXISTS(SELECT 1 FROM cluster_management.refresh_history WHERE id=NEW.id) THEN
    expected:='{"scope":"platform"}'::jsonb;
  ELSIF NEW.kind IN ('cluster-metrics','cluster-storage') AND EXISTS(SELECT 1 FROM cluster_management.metric_collectors
      WHERE 'cluster-'||kind=NEW.kind AND request_id=NEW.id) THEN expected:='{"scope":"platform"}'::jsonb;
  ELSIF NEW.kind='cluster-operation' THEN
    SELECT cluster_management.operation_origin(body) INTO expected FROM cluster_management.operations WHERE id=NEW.id;
  END IF;
  IF expected IS NULL OR NEW.material IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Cluster infrastructure ownership needs the actual original owner row' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cluster_infrastructure_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON cluster_management.infrastructure_origins
  FOR EACH ROW EXECUTE FUNCTION cluster_management.guard_infrastructure_origin();
CREATE TRIGGER cluster_infrastructure_origin_truncate BEFORE TRUNCATE ON cluster_management.infrastructure_origins
  FOR EACH STATEMENT EXECUTE FUNCTION cluster_management.guard_infrastructure_origin();

CREATE FUNCTION cluster_management.capture_infrastructure_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_kind text; source_id text; material jsonb; original jsonb;
BEGIN
  IF TG_TABLE_NAME='refresh_history' THEN source_kind:='cluster-refresh';source_id:=NEW.id;material:='{"scope":"platform"}'::jsonb;
  ELSIF TG_TABLE_NAME='metric_collectors' THEN
    IF NEW.kind NOT IN ('metrics','storage') THEN RETURN NEW; END IF;
    source_kind:='cluster-'||NEW.kind;source_id:=NEW.request_id;material:='{"scope":"platform"}'::jsonb;
  ELSE source_kind:='cluster-operation';source_id:=NEW.id;material:=cluster_management.operation_origin(NEW.body);
    IF TG_OP='UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'Original cluster operation identity is immutable' USING ERRCODE='55000'; END IF;
  END IF;
  SELECT o.material INTO original FROM cluster_management.infrastructure_origins o WHERE kind=source_kind AND id=source_id;
  IF original IS NOT NULL THEN
    IF original IS DISTINCT FROM material THEN RAISE EXCEPTION 'Original cluster operation ownership is immutable' USING ERRCODE='55000'; END IF;
  ELSE
    INSERT INTO cluster_management.infrastructure_origins VALUES(source_kind,source_id,material);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cluster_refresh_origin_capture AFTER INSERT ON cluster_management.refresh_history FOR EACH ROW EXECUTE FUNCTION cluster_management.capture_infrastructure_origin();
CREATE TRIGGER cluster_collector_origin_capture AFTER INSERT OR UPDATE ON cluster_management.metric_collectors FOR EACH ROW EXECUTE FUNCTION cluster_management.capture_infrastructure_origin();
CREATE TRIGGER cluster_operation_origin_capture AFTER INSERT OR UPDATE ON cluster_management.operations FOR EACH ROW EXECUTE FUNCTION cluster_management.capture_infrastructure_origin();
