-- 只留原 ID 与项目归属，原 OpenAPI、申请理由与授权内容不进入墓碑。
CREATE TABLE api_catalog.deletion_fences(project_id text PRIMARY KEY,operation_id text,generation integer NOT NULL DEFAULT 0,confirmed_revision text,scope_verified boolean NOT NULL DEFAULT false);
CREATE TABLE api_catalog.deletion_entities(kind text NOT NULL,entity_id text NOT NULL,project_id text NOT NULL,PRIMARY KEY(kind,entity_id));
INSERT INTO api_catalog.deletion_entities SELECT DISTINCT 'service',service_id,project_id FROM api_catalog.proxies
UNION SELECT DISTINCT 'service',service_id,project_id FROM api_catalog.requests;
INSERT INTO api_catalog.deletion_entities SELECT 'proxy',id,project_id FROM api_catalog.proxies;
INSERT INTO api_catalog.deletion_entities SELECT 'operation',o.id,p.project_id FROM api_catalog.operations AS o JOIN api_catalog.proxies AS p ON p.id=o.proxy_id;
INSERT INTO api_catalog.deletion_entities SELECT 'request',id,project_id FROM api_catalog.requests;
INSERT INTO api_catalog.deletion_entities SELECT 'allocation',r.operation_id,e.project_id FROM api_catalog.allocation_receipts AS r JOIN api_catalog.deletion_entities AS e ON e.kind='service' AND e.entity_id=r.service_id;

CREATE FUNCTION api_catalog.bind_service_owner(service_key text,project_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE deletion_id text;existing_owner text;
BEGIN
  INSERT INTO api_catalog.deletion_fences(project_id) VALUES(project_key) ON CONFLICT DO NOTHING;
  SELECT operation_id INTO deletion_id FROM api_catalog.deletion_fences WHERE project_id=project_key FOR UPDATE;
  IF deletion_id IS NOT NULL THEN RAISE EXCEPTION 'project API catalog is sealed for deletion' USING ERRCODE='55000'; END IF;
  INSERT INTO api_catalog.deletion_entities VALUES('service',service_key,project_key) ON CONFLICT DO NOTHING;
  SELECT project_id INTO existing_owner FROM api_catalog.deletion_entities WHERE kind='service' AND entity_id=service_key;
  IF existing_owner IS DISTINCT FROM project_key THEN RAISE EXCEPTION 'API catalog identity ownership is immutable' USING ERRCODE='55000'; END IF;
END $$;

CREATE FUNCTION api_catalog.content_projects(content_table text,body jsonb) RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT body->>'project_id' WHERE content_table IN ('proxies','requests')
  UNION SELECT project_id FROM api_catalog.deletion_entities WHERE
    (kind='service' AND entity_id=body->>'service_id') OR
    (kind='proxy' AND entity_id=body->>'proxy_id') OR
    (kind='operation' AND entity_id=body->>'operation_id' AND content_table IN ('grants','requests')) OR
    (kind='allocation' AND entity_id=body->>'operation_id' AND content_table='allocation_receipts') OR
    (kind=CASE content_table WHEN 'proxies' THEN 'proxy' WHEN 'operations' THEN 'operation' WHEN 'requests' THEN 'request' END AND entity_id=body->>'id')
$$;
CREATE FUNCTION api_catalog.content_owner(content_table text,body jsonb) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(CASE WHEN content_table IN ('proxies','requests') THEN body->>'project_id' END,
    (SELECT project_id FROM api_catalog.deletion_entities WHERE kind=CASE WHEN content_table='operations' THEN 'proxy' ELSE 'service' END
      AND entity_id=CASE WHEN content_table='operations' THEN body->>'proxy_id' ELSE body->>'service_id' END))
$$;
CREATE FUNCTION api_catalog.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_body jsonb;new_body jsonb;target_ids text[];target_id text;deletion_id text;marker text;own_id text;entity_kind text;entity_key text;existing_owner text;internal_change boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN old_body:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_body:=to_jsonb(NEW); END IF;
  SELECT array_agg(id ORDER BY id) INTO target_ids FROM (
    SELECT DISTINCT id FROM (SELECT api_catalog.content_projects(TG_TABLE_NAME,old_body) AS id UNION SELECT api_catalog.content_projects(TG_TABLE_NAME,new_body) AS id) targets WHERE id IS NOT NULL
  ) targets;
  marker:=current_setting('crewstation.api_catalog_deletion',true);
  own_id:=api_catalog.content_owner(TG_TABLE_NAME,coalesce(new_body,old_body));
  SELECT EXISTS(SELECT 1 FROM api_catalog.deletion_fences WHERE project_id=ANY(target_ids) AND operation_id=marker) INTO internal_change;
  IF internal_change AND TG_OP='UPDATE' THEN
    internal_change:=new_body->>'state' IN ('removed','revoked','rejected')
      AND (new_body-ARRAY['state','updated_at','revoked_at','decided_at','decision'])=(old_body-ARRAY['state','updated_at','revoked_at','decided_at','decision'])
      AND (new_body->>'decision' IS NOT DISTINCT FROM old_body->>'decision' OR new_body->>'decision'='目标项目已永久删除');
  ELSIF internal_change AND TG_OP='DELETE' THEN
    SELECT EXISTS(SELECT 1 FROM api_catalog.deletion_fences WHERE project_id=own_id AND operation_id=marker) INTO internal_change;
  ELSE internal_change:=false; END IF;
  FOREACH target_id IN ARRAY coalesce(target_ids,ARRAY[]::text[]) LOOP
    INSERT INTO api_catalog.deletion_fences(project_id) VALUES(target_id) ON CONFLICT DO NOTHING;
    SELECT operation_id INTO deletion_id FROM api_catalog.deletion_fences WHERE project_id=target_id FOR UPDATE;
    IF deletion_id IS NOT NULL AND NOT internal_change THEN RAISE EXCEPTION 'project API catalog is sealed for deletion' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF TG_TABLE_NAME IN ('grants','allocation_receipts') AND own_id IS NULL AND NOT internal_change THEN
    RAISE EXCEPTION 'API catalog service ownership is unresolved' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  entity_kind:=CASE TG_TABLE_NAME WHEN 'proxies' THEN 'proxy' WHEN 'operations' THEN 'operation' WHEN 'requests' THEN 'request' WHEN 'allocation_receipts' THEN 'allocation' END;
  entity_key:=CASE WHEN TG_TABLE_NAME='allocation_receipts' THEN new_body->>'operation_id' ELSE new_body->>'id' END;
  IF own_id IS NOT NULL AND entity_kind IS NOT NULL THEN
    INSERT INTO api_catalog.deletion_entities VALUES(entity_kind,entity_key,own_id) ON CONFLICT DO NOTHING;
    SELECT project_id INTO existing_owner FROM api_catalog.deletion_entities WHERE kind=entity_kind AND entity_id=entity_key;
    IF existing_owner IS DISTINCT FROM own_id THEN RAISE EXCEPTION 'API catalog identity ownership is immutable' USING ERRCODE='55000'; END IF;
  END IF;
  IF own_id IS NOT NULL AND TG_TABLE_NAME IN ('proxies','requests') THEN
    INSERT INTO api_catalog.deletion_entities VALUES('service',new_body->>'service_id',own_id) ON CONFLICT DO NOTHING;
    SELECT project_id INTO existing_owner FROM api_catalog.deletion_entities WHERE kind='service' AND entity_id=new_body->>'service_id';
    IF existing_owner IS DISTINCT FROM own_id THEN RAISE EXCEPTION 'API catalog identity ownership is immutable' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE content_table text; BEGIN
  FOREACH content_table IN ARRAY ARRAY['proxies','operations','grants','requests','allocation_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER api_catalog_project_content_fence BEFORE INSERT OR UPDATE OR DELETE ON api_catalog.%I FOR EACH ROW EXECUTE FUNCTION api_catalog.guard_project_content()',content_table);
  END LOOP;
END $$;
