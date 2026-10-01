-- 原项目／服务／内容 ID 是持久身份；域名标识可在原根彻底销毁后由新项目复用。
-- 旧 project-slug 记录作为历史最小事实保留，但不再作为新内容的准入身份。
CREATE OR REPLACE FUNCTION events.content_owner(content_table text,body jsonb) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(CASE WHEN content_table IN ('producers','subscriptions','deliveries') THEN body->>'project_id' END,
    (SELECT project_id FROM events.deletion_entities WHERE kind=events.entity_kind(content_table) AND entity_key=body->>'id'),
    (SELECT project_id FROM events.deletion_entities WHERE kind='producer' AND entity_key=body->>'producer_id'))
$$;
CREATE OR REPLACE FUNCTION events.content_projects(content_table text,body jsonb) RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT events.content_owner(content_table,body) WHERE events.content_owner(content_table,body) IS NOT NULL
  UNION SELECT project_id FROM events.deletion_entities WHERE
    (kind=events.entity_kind(content_table) AND entity_key=body->>'id') OR
    (kind='service' AND entity_key=body->>'service_id') OR
    (kind='producer' AND entity_key=body->>'producer_id') OR
    (kind='event-type' AND entity_key=body->>'event_type_id') OR
    (kind='event' AND entity_key=body->>'event_id') OR
    (kind='subscription' AND entity_key=body->>'subscription_id')
  UNION SELECT project_id FROM events.deletion_links WHERE kind=events.entity_kind(content_table) AND entity_key=body->>'id'
$$;
CREATE OR REPLACE FUNCTION events.guard_project_content() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF own_id IS NULL THEN RAISE EXCEPTION 'original event owner is unresolved' USING ERRCODE='55000'; END IF;
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
  INSERT INTO events.deletion_links SELECT events.entity_kind(TG_TABLE_NAME),new_body->>'id',id FROM events.content_projects(TG_TABLE_NAME,new_body) id ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
