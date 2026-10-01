CREATE TABLE gateway.deletion_fences(project_id text PRIMARY KEY,operation_id text,generation integer NOT NULL DEFAULT 0,confirmed_revision text,scope_verified boolean NOT NULL DEFAULT false);
CREATE TABLE gateway.deletion_entities(kind text NOT NULL,entity_key text NOT NULL,project_id text NOT NULL,PRIMARY KEY(kind,entity_key));
CREATE TABLE gateway.deletion_document_owners(version integer NOT NULL,kind text NOT NULL CHECK(kind IN ('caller','operation')),entity_key text NOT NULL,project_id text NOT NULL,PRIMARY KEY(version,kind,entity_key));
CREATE TABLE gateway.deletion_work(id text PRIMARY KEY,project_id text NOT NULL,kind text NOT NULL,backend_pid integer NOT NULL,generation integer NOT NULL CHECK(generation>0),state text NOT NULL CHECK(state IN ('running','finished')),pod_uid text,container_id text,node_uid text,node_name text,proof_digest text CHECK(proof_digest IS NULL OR proof_digest~'^[a-f0-9]{64}$'),CHECK((pod_uid IS NULL)=(container_id IS NULL) AND (pod_uid IS NULL)=(node_uid IS NULL) AND (pod_uid IS NULL)=(node_name IS NULL)));
CREATE TABLE gateway.deletion_process_stops(pod_uid text NOT NULL,container_id text NOT NULL,node_uid text NOT NULL,node_name text NOT NULL,proof_digest text NOT NULL CHECK(proof_digest~'^[a-f0-9]{64}$'),PRIMARY KEY(pod_uid,container_id,node_uid,node_name));
INSERT INTO gateway.deletion_entities SELECT 'service',service_id,project_id FROM gateway.service_maintenance;
INSERT INTO gateway.deletion_entities SELECT 'allocation',operation_id,project_id FROM gateway.rate_limit_receipts;

CREATE FUNCTION gateway.remember_entity(entity_kind text,entity text,target text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE original_owner text;
BEGIN
 IF entity_kind IS NULL OR entity IS NULL OR target IS NULL THEN RAISE EXCEPTION 'gateway original ownership is required' USING ERRCODE='55000'; END IF;
 INSERT INTO gateway.deletion_entities VALUES(entity_kind,entity,target) ON CONFLICT DO NOTHING;
 SELECT project_id INTO original_owner FROM gateway.deletion_entities WHERE kind=entity_kind AND entity_key=entity;
 IF original_owner IS DISTINCT FROM target THEN RAISE EXCEPTION 'gateway original ownership is immutable' USING ERRCODE='55000'; END IF;
END $$;
CREATE FUNCTION gateway.pod_key(body jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(nullif(body->>'pod_uid',''),body->'service_source'->>'podUid',body->'development_source'->>'podUid','legacy:' || (body->>'namespace') || '/' || (body->>'pod_name'))
$$;
CREATE FUNCTION gateway.content_owner(content_table text,body jsonb) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE content_table
 WHEN 'service_maintenance' THEN body->>'project_id'
 WHEN 'rate_limit_receipts' THEN body->>'project_id'
 WHEN 'rate_limits' THEN CASE WHEN body->>'scope'<>'platform' THEN body->>'scope' END
 WHEN 'pod_identities' THEN (SELECT project_id FROM gateway.deletion_entities WHERE kind='pod' AND entity_key=gateway.pod_key(body))
 ELSE (SELECT project_id FROM gateway.deletion_entities WHERE kind='service' AND entity_key=body->>'service_id') END
$$;
CREATE FUNCTION gateway.actual_shared_admission(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('crewstation.shared_admission_keys',true),''),'[]')::jsonb ? ('gateway.project-admission:' || target)
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock'
 AND pid=coalesce(nullif(current_setting('crewstation.shared_admission_pid',true),''),'0')::integer
 AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
 AND classid::bigint=((hashtextextended('gateway.project-admission:' || target,0) >> 32) & 4294967295)
 AND objid::bigint=(hashtextextended('gateway.project-admission:' || target,0) & 4294967295))
$$;
CREATE FUNCTION gateway.guard_original_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'gateway minimal original facts are immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER gateway_original_entity_guard BEFORE UPDATE OR DELETE ON gateway.deletion_entities FOR EACH ROW EXECUTE FUNCTION gateway.guard_original_facts();
CREATE TRIGGER gateway_original_document_guard BEFORE UPDATE OR DELETE ON gateway.deletion_document_owners FOR EACH ROW EXECUTE FUNCTION gateway.guard_original_facts();
CREATE TRIGGER gateway_original_stop_guard BEFORE UPDATE OR DELETE ON gateway.deletion_process_stops FOR EACH ROW EXECUTE FUNCTION gateway.guard_original_facts();

CREATE FUNCTION gateway.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_body jsonb;new_body jsonb;target text;old_target text;deletion_id text;marker text;observing boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN old_body:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_body:=to_jsonb(NEW); END IF;
 target:=gateway.content_owner(TG_TABLE_NAME,coalesce(new_body,old_body));old_target:=gateway.content_owner(TG_TABLE_NAME,old_body);
 IF TG_TABLE_NAME='service_maintenance' AND TG_OP<>'DELETE' THEN PERFORM gateway.remember_entity('service',new_body->>'service_id',target); END IF;
 IF TG_TABLE_NAME='rate_limit_receipts' AND TG_OP<>'DELETE' THEN PERFORM gateway.remember_entity('allocation',new_body->>'operation_id',target); END IF;
 IF TG_OP='UPDATE' AND old_target IS DISTINCT FROM target THEN RAISE EXCEPTION 'gateway content ownership is immutable' USING ERRCODE='55000'; END IF;
 IF target IS NULL THEN
   IF TG_TABLE_NAME='rate_limits' AND coalesce(new_body,old_body)->>'scope'='platform' THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
   IF TG_TABLE_NAME='pod_identities' AND coalesce(new_body,old_body)->>'workload'='platform' THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
   IF TG_OP='UPDATE' AND TG_TABLE_NAME='pod_identities' AND new_body-ARRAY['version','updated_at','deleted_at']=old_body-ARRAY['version','updated_at','deleted_at'] THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'gateway original project ownership is unknown' USING ERRCODE='55000';
 END IF;
 marker:=current_setting('crewstation.gateway_deletion',true);
 IF NOT coalesce(gateway.actual_shared_admission(target),false) THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended('gateway.project-admission:' || target,0)); END IF;
 SELECT operation_id INTO deletion_id FROM gateway.deletion_fences WHERE project_id=target;
 observing:=TG_OP='UPDATE' AND TG_TABLE_NAME='pod_identities'
   AND new_body-ARRAY['version','updated_at','deleted_at','service_source','development_source']=old_body-ARRAY['version','updated_at','deleted_at','service_source','development_source']
   AND (nullif(new_body->'service_source','null'::jsonb)-'ready') IS NOT DISTINCT FROM (nullif(old_body->'service_source','null'::jsonb)-'ready')
   AND (nullif(new_body->'development_source','null'::jsonb)-'ready') IS NOT DISTINCT FROM (nullif(old_body->'development_source','null'::jsonb)-'ready');
 IF deletion_id IS NOT NULL AND NOT coalesce(TG_OP='DELETE' AND marker=deletion_id,false) AND NOT coalesce(observing,false) THEN RAISE EXCEPTION 'project gateway content is sealed for deletion' USING ERRCODE='55000'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE content_table text; BEGIN
 FOREACH content_table IN ARRAY ARRAY['pod_identities','routes','service_maintenance','maintenance_events','rate_limits','rate_limit_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER gateway_project_content_fence BEFORE INSERT OR UPDATE OR DELETE ON gateway.%I FOR EACH ROW EXECUTE FUNCTION gateway.guard_project_content()',content_table);
 END LOOP;
END $$;

CREATE FUNCTION gateway.strip_document(doc jsonb,document_version integer,projects text[]) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE callers text[];operations text[];entries jsonb;value jsonb;
BEGIN
 SELECT array_agg(entity_key) INTO callers FROM gateway.deletion_document_owners WHERE version=document_version AND kind='caller' AND project_id=ANY(projects);
 SELECT array_agg(entity_key) INTO operations FROM gateway.deletion_document_owners WHERE version=document_version AND kind='operation' AND project_id=ANY(projects);
 callers:=coalesce(callers,ARRAY[]::text[]);operations:=coalesce(operations,ARRAY[]::text[]);
 IF doc ? 'entries' THEN
   SELECT coalesce(jsonb_agg(CASE WHEN entry ? 'operations' THEN jsonb_set(entry,'{operations}',coalesce((SELECT jsonb_agg(operation ORDER BY ord) FROM jsonb_array_elements(entry->'operations') WITH ORDINALITY AS o(operation,ord) WHERE NOT (operation#>>'{}'=ANY(operations))),'[]'::jsonb)) ELSE entry END ORDER BY position),'[]'::jsonb)
   INTO entries FROM jsonb_array_elements(doc->'entries') WITH ORDINALITY AS e(entry,position) WHERE NOT (entry->>'caller'=ANY(callers));
   doc:=jsonb_set(doc,'{entries}',entries);
 END IF;
 IF doc ? 'operationRoutes' THEN
   SELECT coalesce(jsonb_agg(route ORDER BY position),'[]'::jsonb) INTO value FROM jsonb_array_elements(doc->'operationRoutes') WITH ORDINALITY AS e(route,position) WHERE NOT (route->>'id'=ANY(operations));
   doc:=jsonb_set(doc,'{operationRoutes}',value);
 END IF;
 IF doc ? 'defaultOpen' THEN
   SELECT coalesce(jsonb_agg(operation ORDER BY position),'[]'::jsonb) INTO value FROM jsonb_array_elements(doc->'defaultOpen') WITH ORDINALITY AS e(operation,position) WHERE NOT (operation#>>'{}'=ANY(operations));
   doc:=jsonb_set(doc,'{defaultOpen}',value);
 END IF;
 RETURN doc;
END $$;
CREATE FUNCTION gateway.guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;marker text;projects text[];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'shared gateway document cannot be deleted wholesale' USING ERRCODE='55000'; END IF;
 IF TG_OP='UPDATE' THEN
   marker:=current_setting('crewstation.gateway_deletion',true);
   SELECT project_id INTO target FROM gateway.deletion_fences WHERE operation_id=marker AND scope_verified;
   IF target IS NULL OR NEW.version<>OLD.version OR NEW.generated_at<>OLD.generated_at OR NEW.document IS DISTINCT FROM gateway.strip_document(OLD.document,OLD.version,ARRAY[target]) THEN
     RAISE EXCEPTION 'historical gateway document permits only granted project removal' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.document->>'version' IS DISTINCT FROM NEW.version::text OR jsonb_typeof(NEW.document->'entries') IS DISTINCT FROM 'array'
 OR jsonb_typeof(NEW.document->'defaultOpen') IS DISTINCT FROM 'array'
 OR (NEW.document ? 'operationRoutes' AND jsonb_typeof(NEW.document->'operationRoutes') IS DISTINCT FROM 'array') THEN
   RAISE EXCEPTION 'gateway document structure is not verifiable' USING ERRCODE='55000';
 END IF;
 IF (
 EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'entries') e WHERE NOT EXISTS(SELECT 1 FROM gateway.deletion_document_owners AS d WHERE d.version=NEW.version AND d.kind='caller' AND d.entity_key=e->>'caller'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'operationRoutes') e WHERE NOT EXISTS(SELECT 1 FROM gateway.deletion_document_owners AS d WHERE d.version=NEW.version AND d.kind='operation' AND d.entity_key=e->>'id'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'defaultOpen') e WHERE NOT EXISTS(SELECT 1 FROM gateway.deletion_document_owners AS d WHERE d.version=NEW.version AND d.kind='operation' AND d.entity_key=e#>>'{}'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'entries') e CROSS JOIN LATERAL jsonb_array_elements(e->'operations') operation WHERE NOT EXISTS(SELECT 1 FROM gateway.deletion_document_owners AS d WHERE d.version=NEW.version AND d.kind='operation' AND d.entity_key=operation#>>'{}'))) THEN
   RAISE EXCEPTION 'new gateway document requires original project lineage' USING ERRCODE='55000';
 END IF;
 FOR target IN SELECT DISTINCT project_id FROM gateway.deletion_document_owners WHERE version=NEW.version ORDER BY project_id LOOP
   PERFORM pg_advisory_xact_lock_shared(hashtextextended('gateway.project-admission:' || target,0));
 END LOOP;
 SELECT array_agg(project_id) INTO projects FROM gateway.deletion_fences WHERE operation_id IS NOT NULL;
 NEW.document:=gateway.strip_document(NEW.document,NEW.version,coalesce(projects,ARRAY[]::text[]));
 RETURN NEW;
END $$;
CREATE TRIGGER gateway_document_fence BEFORE INSERT OR UPDATE OR DELETE ON gateway.allowlists FOR EACH ROW EXECUTE FUNCTION gateway.guard_document();

CREATE FUNCTION gateway.guard_project_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deletion_id text;exiting boolean;marker text;
BEGIN
 IF TG_OP='DELETE' THEN
   marker:=current_setting('crewstation.gateway_deletion',true);
   IF OLD.state<>'finished' OR NOT EXISTS(SELECT 1 FROM gateway.deletion_fences WHERE project_id=OLD.project_id AND operation_id=marker AND scope_verified) THEN RAISE EXCEPTION 'gateway work cleanup requires actual exit and grant' USING ERRCODE='55000'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
   exiting:=OLD.state='running' AND NEW.state='finished' AND current_setting('crewstation.gateway_work_exit',true)=OLD.id || ':' || OLD.generation || ':' || OLD.backend_pid
    AND (to_jsonb(NEW)-ARRAY['state','proof_digest'])=(to_jsonb(OLD)-ARRAY['state','proof_digest']);
   IF NOT coalesce(exiting,false) THEN RAISE EXCEPTION 'gateway work exit requires original callback or process proof' USING ERRCODE='55000'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.state<>'running' OR NEW.generation<>1 OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) OR NOT coalesce(gateway.actual_shared_admission(NEW.project_id),false) THEN
   RAISE EXCEPTION 'gateway external work requires actual project admission' USING ERRCODE='55000';
 END IF;
 SELECT operation_id INTO deletion_id FROM gateway.deletion_fences WHERE project_id=NEW.project_id;
 IF deletion_id IS NOT NULL THEN RAISE EXCEPTION 'gateway external work is sealed for deletion' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gateway_work_fence BEFORE INSERT OR UPDATE OR DELETE ON gateway.deletion_work FOR EACH ROW EXECUTE FUNCTION gateway.guard_project_work();
