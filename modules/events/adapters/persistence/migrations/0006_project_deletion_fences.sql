-- 原 ID／项目关系是最小防重放事实，不保留载荷、路径、原生输出或错误正文。
CREATE TABLE events.deletion_fences(project_id text PRIMARY KEY,operation_id text,generation integer NOT NULL DEFAULT 0,confirmed_revision text,scope_verified boolean NOT NULL DEFAULT false);
CREATE TABLE events.deletion_entities(kind text NOT NULL,entity_key text NOT NULL,project_id text NOT NULL,PRIMARY KEY(kind,entity_key));
CREATE TABLE events.deletion_links(kind text NOT NULL,entity_key text NOT NULL,project_id text NOT NULL,PRIMARY KEY(kind,entity_key,project_id));
INSERT INTO events.deletion_entities SELECT 'producer',id,project_id FROM events.producers;
INSERT INTO events.deletion_entities SELECT DISTINCT 'service',service_id,project_id FROM events.producers UNION SELECT DISTINCT 'service',service_id,project_id FROM events.subscriptions UNION SELECT DISTINCT 'service',service_id,project_id FROM events.deliveries;
INSERT INTO events.deletion_entities SELECT DISTINCT 'project-slug',project_slug,project_id FROM events.producers;
INSERT INTO events.deletion_entities SELECT 'event-type',t.id,p.project_id FROM events.event_types AS t JOIN events.producers AS p ON p.id=t.producer_id;
INSERT INTO events.deletion_entities SELECT 'event',i.id,p.project_id FROM events.inbox AS i JOIN events.producers AS p ON p.id=i.producer_id;
INSERT INTO events.deletion_entities SELECT 'subscription',id,project_id FROM events.subscriptions;
INSERT INTO events.deletion_entities SELECT 'delivery',id,project_id FROM events.deliveries;

CREATE FUNCTION events.entity_kind(content_table text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE content_table WHEN 'producers' THEN 'producer' WHEN 'event_types' THEN 'event-type' WHEN 'inbox' THEN 'event' WHEN 'subscriptions' THEN 'subscription' WHEN 'deliveries' THEN 'delivery' END
$$;
CREATE FUNCTION events.content_owner(content_table text,body jsonb) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(CASE WHEN content_table IN ('producers','subscriptions','deliveries') THEN body->>'project_id' END,
    (SELECT project_id FROM events.deletion_entities WHERE kind='producer' AND entity_key=body->>'producer_id'),
    (SELECT project_id FROM events.deletion_entities WHERE kind='project-slug' AND entity_key=body->>'producer_project'))
$$;
CREATE FUNCTION events.content_projects(content_table text,body jsonb) RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT events.content_owner(content_table,body) WHERE events.content_owner(content_table,body) IS NOT NULL
  UNION SELECT project_id FROM events.deletion_entities WHERE
    (kind=events.entity_kind(content_table) AND entity_key=body->>'id') OR
    (kind='service' AND entity_key=body->>'service_id') OR
    (kind='producer' AND entity_key=body->>'producer_id') OR
    (kind='event-type' AND entity_key=body->>'event_type_id') OR
    (kind='event' AND entity_key=body->>'event_id') OR
    (kind='subscription' AND entity_key=body->>'subscription_id') OR
    (kind='project-slug' AND entity_key=body->>'producer_project')
  UNION SELECT project_id FROM events.deletion_links WHERE kind=events.entity_kind(content_table) AND entity_key=body->>'id'
$$;
DO $$ DECLARE content_table text; BEGIN
  FOREACH content_table IN ARRAY ARRAY['producers','event_types','subscriptions','inbox','deliveries'] LOOP
    EXECUTE format('INSERT INTO events.deletion_links SELECT events.entity_kind(%L),c.id,related FROM events.%I c CROSS JOIN LATERAL events.content_projects(%L,to_jsonb(c)) related ON CONFLICT DO NOTHING',content_table,content_table,content_table);
  END LOOP;
END $$;

CREATE FUNCTION events.actual_shared_admission(target text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('crewstation.shared_admission_keys',true),''),'[]')::jsonb ? ('events.project-admission:' || target)
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND granted AND mode='ShareLock'
      AND pid=coalesce(nullif(current_setting('crewstation.shared_admission_pid',true),''),'0')::integer
      AND database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) AND objsubid=1
      AND classid::bigint=((hashtextextended('events.project-admission:' || target,0) >> 32) & 4294967295)
      AND objid::bigint=(hashtextextended('events.project-admission:' || target,0) & 4294967295))
$$;
CREATE FUNCTION events.remember_entity(entity_kind text,entity text,target text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE original_owner text;
BEGIN
  IF entity_kind IS NULL OR entity IS NULL OR target IS NULL THEN RETURN; END IF;
  INSERT INTO events.deletion_entities VALUES(entity_kind,entity,target) ON CONFLICT DO NOTHING;
  SELECT project_id INTO original_owner FROM events.deletion_entities WHERE kind=entity_kind AND entity_key=entity;
  IF original_owner IS DISTINCT FROM target THEN RAISE EXCEPTION 'event identity ownership is immutable' USING ERRCODE='55000'; END IF;
END $$;
CREATE FUNCTION events.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_body jsonb;new_body jsonb;ids text[];target text;deletion_id text;marker text;own_id text;internal_change boolean;safe_foreign_remove boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN old_body:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_body:=to_jsonb(NEW); END IF;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM unnest(CASE TG_TABLE_NAME
    WHEN 'producers' THEN ARRAY['id','project_id','service_id']
    WHEN 'event_types' THEN ARRAY['id','producer_id']
    WHEN 'inbox' THEN ARRAY['id','producer_id','event_type_id']
    WHEN 'subscriptions' THEN ARRAY['id','project_id','service_id','event_type_id']
    ELSE ARRAY['id','project_id','service_id','event_id','subscription_id','event_type_id'] END) field WHERE new_body->field IS DISTINCT FROM old_body->field) THEN
    RAISE EXCEPTION 'original event lineage is immutable' USING ERRCODE='55000';
  END IF;
  SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT DISTINCT id FROM (SELECT events.content_projects(TG_TABLE_NAME,old_body) AS id UNION SELECT events.content_projects(TG_TABLE_NAME,new_body) AS id) related WHERE id IS NOT NULL) targets;
  own_id:=events.content_owner(TG_TABLE_NAME,coalesce(new_body,old_body));
  marker:=current_setting('crewstation.events_deletion',true);
  SELECT EXISTS(SELECT 1 FROM events.deletion_fences WHERE project_id=ANY(ids) AND operation_id=marker) INTO internal_change;
  IF internal_change AND TG_OP='DELETE' THEN
    internal_change:=TG_TABLE_NAME='deliveries' OR EXISTS(SELECT 1 FROM events.deletion_fences WHERE project_id=own_id AND operation_id=marker);
  ELSIF internal_change AND TG_OP='UPDATE' THEN
    internal_change:=TG_TABLE_NAME='subscriptions' AND new_body->>'state'='paused' AND (new_body-ARRAY['state','updated_at'])=(old_body-ARRAY['state','updated_at']);
  ELSE internal_change:=false; END IF;
  safe_foreign_remove:=TG_OP='DELETE' AND TG_TABLE_NAME='subscriptions' AND NOT EXISTS(SELECT 1 FROM events.deletion_fences WHERE project_id=own_id AND operation_id IS NOT NULL);
  FOREACH target IN ARRAY coalesce(ids,ARRAY[]::text[]) LOOP
    IF NOT internal_change AND NOT (safe_foreign_remove AND target<>own_id) AND NOT coalesce(events.actual_shared_admission(target),false) THEN
      IF EXISTS(SELECT 1 FROM unnest(ids) admitted WHERE coalesce(events.actual_shared_admission(admitted),false)) THEN
        RAISE EXCEPTION 'event admission does not cover every project' USING ERRCODE='55000';
      END IF;
      PERFORM pg_advisory_xact_lock_shared(hashtextextended('events.project-admission:' || target,0));
    END IF;
    SELECT operation_id INTO deletion_id FROM events.deletion_fences WHERE project_id=target;
    IF deletion_id IS NOT NULL AND NOT internal_change AND NOT (safe_foreign_remove AND target<>own_id) THEN RAISE EXCEPTION 'project events are sealed for deletion' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  PERFORM events.remember_entity(events.entity_kind(TG_TABLE_NAME),new_body->>'id',own_id);
  IF TG_TABLE_NAME IN ('producers','subscriptions','deliveries') THEN PERFORM events.remember_entity('service',new_body->>'service_id',own_id); END IF;
  IF TG_TABLE_NAME='producers' THEN PERFORM events.remember_entity('project-slug',new_body->>'project_slug',own_id); END IF;
  INSERT INTO events.deletion_links SELECT events.entity_kind(TG_TABLE_NAME),new_body->>'id',id FROM events.content_projects(TG_TABLE_NAME,new_body) id ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DO $$ DECLARE content_table text; BEGIN
  FOREACH content_table IN ARRAY ARRAY['producers','event_types','subscriptions','inbox','deliveries'] LOOP
    EXECUTE format('CREATE TRIGGER events_project_content_fence BEFORE INSERT OR UPDATE OR DELETE ON events.%I FOR EACH ROW EXECUTE FUNCTION events.guard_project_content()',content_table);
  END LOOP;
END $$;

CREATE TABLE events.deletion_work(delivery_id text PRIMARY KEY,backend_pid integer NOT NULL,generation integer NOT NULL CHECK(generation>0),state text NOT NULL CHECK(state IN ('running','finished')),pod_uid text,container_id text,node_uid text,node_name text,proof_digest text CHECK(proof_digest IS NULL OR proof_digest~'^[a-f0-9]{64}$'),CHECK((pod_uid IS NULL)=(container_id IS NULL) AND (pod_uid IS NULL)=(node_uid IS NULL) AND (pod_uid IS NULL)=(node_name IS NULL)));
CREATE TABLE events.deletion_process_stops(pod_uid text NOT NULL,container_id text NOT NULL,node_uid text NOT NULL,node_name text NOT NULL,proof_digest text NOT NULL CHECK(proof_digest~'^[a-f0-9]{64}$'),PRIMARY KEY(pod_uid,container_id,node_uid,node_name));
CREATE FUNCTION events.guard_delivery_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;deletion_id text;exiting boolean;marker text;
BEGIN
  IF TG_OP='DELETE' THEN
    marker:=current_setting('crewstation.events_deletion',true);
    IF OLD.state<>'finished' OR NOT EXISTS(SELECT 1 FROM events.deletion_fences AS f JOIN events.deletion_links AS l ON l.project_id=f.project_id WHERE l.kind='delivery' AND l.entity_key=OLD.delivery_id AND f.operation_id=marker) THEN
      RAISE EXCEPTION 'delivery work cleanup requires actual exit and deletion grant' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND NEW.state='finished' THEN
    exiting:=OLD.state='running' AND current_setting('crewstation.events_work_exit',true)=OLD.delivery_id || ':' || OLD.generation || ':' || OLD.backend_pid
      AND NEW.delivery_id=OLD.delivery_id AND NEW.backend_pid=OLD.backend_pid AND NEW.generation=OLD.generation AND NEW.pod_uid IS NOT DISTINCT FROM OLD.pod_uid AND NEW.container_id IS NOT DISTINCT FROM OLD.container_id AND NEW.node_uid IS NOT DISTINCT FROM OLD.node_uid AND NEW.node_name IS NOT DISTINCT FROM OLD.node_name;
    IF NOT coalesce(exiting,false) THEN RAISE EXCEPTION 'delivery exit requires original callback or process proof' USING ERRCODE='55000'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.state<>'running' OR NEW.backend_pid::text IS DISTINCT FROM current_setting('crewstation.shared_admission_pid',true) OR
    (TG_OP='INSERT' AND NEW.generation<>1) OR (TG_OP='UPDATE' AND (OLD.state<>'finished' OR NEW.delivery_id<>OLD.delivery_id OR NEW.generation<>OLD.generation+1)) THEN
    RAISE EXCEPTION 'delivery work generation or original admission is invalid' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM events.deletion_links WHERE kind='delivery' AND entity_key=NEW.delivery_id) THEN RAISE EXCEPTION 'delivery project ownership is unresolved' USING ERRCODE='55000'; END IF;
  FOR target IN SELECT project_id FROM events.deletion_links WHERE kind='delivery' AND entity_key=NEW.delivery_id ORDER BY project_id LOOP
    IF NOT coalesce(events.actual_shared_admission(target),false) THEN RAISE EXCEPTION 'delivery requires every actual project admission' USING ERRCODE='55000'; END IF;
    SELECT operation_id INTO deletion_id FROM events.deletion_fences WHERE project_id=target;
    IF deletion_id IS NOT NULL THEN RAISE EXCEPTION 'project events are sealed for deletion' USING ERRCODE='55000'; END IF;
  END LOOP;
  IF NEW.pod_uid IS NOT NULL AND EXISTS(SELECT 1 FROM events.deletion_process_stops WHERE pod_uid=NEW.pod_uid AND container_id=NEW.container_id AND node_uid=NEW.node_uid AND node_name=NEW.node_name) THEN RAISE EXCEPTION 'original delivery process is stopped' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_delivery_work_fence BEFORE INSERT OR UPDATE OR DELETE ON events.deletion_work FOR EACH ROW EXECUTE FUNCTION events.guard_delivery_work();
