-- RFC-038: an operation journal; the existing pipeline and handoff remain execution owners.
CREATE TABLE release.release_journeys (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  project_id text NOT NULL, service_id text NOT NULL, release_id text NOT NULL REFERENCES release.releases(id),
  kind text NOT NULL, status text NOT NULL, revision integer NOT NULL CHECK (revision>=0), request_key text,
  body jsonb NOT NULL, created_at timestamptz NOT NULL,
  CHECK ((body->>'id'=id AND body->'snapshot'->>'projectId'=project_id AND body->'snapshot'->>'serviceId'=service_id
    AND body->'snapshot'->>'releaseId'=release_id AND body->'snapshot'->>'kind'=kind AND body->>'status'=status
    AND (body->>'revision')::integer=revision AND (body->'snapshot'->>'startedAt')::timestamptz=created_at
    AND (body->'launch'->>'requestKey') IS NOT DISTINCT FROM request_key) IS TRUE)
);
CREATE UNIQUE INDEX release_journeys_switch_key ON release.release_journeys(service_id,request_key);
CREATE INDEX release_journeys_history ON release.release_journeys(service_id,created_at DESC,id DESC);
CREATE INDEX release_journeys_release ON release.release_journeys(release_id);
CREATE TABLE release.release_journey_events (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  project_id text NOT NULL, service_id text NOT NULL, release_id text NOT NULL REFERENCES release.releases(id),
  journey_id text NOT NULL REFERENCES release.release_journeys(id), sequence integer NOT NULL CHECK(sequence>0),
  transition_key text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL,
  CHECK ((body->>'id'=id AND body->>'journeyId'=journey_id AND (body->>'sequence')::integer=sequence
    AND body->>'transitionKey'=transition_key AND (body->>'at')::timestamptz=created_at) IS TRUE)
);
CREATE UNIQUE INDEX release_journey_events_key ON release.release_journey_events(journey_id,transition_key);
CREATE UNIQUE INDEX release_journey_events_sequence ON release.release_journey_events(journey_id,sequence);

CREATE FUNCTION release.guard_journey_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source release.releases; parent release.release_journeys; BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT release.deletion_control_owner(OLD.project_id,'metadata') THEN RAISE EXCEPTION 'Journey history requires original metadata deletion grant' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='release_journey_events' OR OLD.release_id<>NEW.release_id OR OLD.created_at<>NEW.created_at
      OR OLD.body->'snapshot' IS DISTINCT FROM NEW.body->'snapshot' THEN
      RAISE EXCEPTION 'Journey birth and events are immutable' USING ERRCODE='55000';
    END IF;
    IF OLD.status IN ('succeeded','failed','interrupted') OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Journey terminal result or revision changed' USING ERRCODE='55000'; END IF;
    IF OLD.body->'verification' IS NOT NULL AND OLD.body->'verification' IS DISTINCT FROM NEW.body->'verification'
      OR OLD.body->'verificationIntent' IS NOT NULL AND OLD.body->'verificationIntent' IS DISTINCT FROM NEW.body->'verificationIntent'
      OR OLD.body->'launch' IS NOT NULL AND OLD.body->'launch' IS DISTINCT FROM NEW.body->'launch'
      OR OLD.body->'targetRevision' IS NOT NULL AND OLD.body->'targetRevision' IS DISTINCT FROM NEW.body->'targetRevision' THEN
      RAISE EXCEPTION 'Journey accepted facts are immutable' USING ERRCODE='55000'; END IF;
  END IF;
  SELECT * INTO source FROM release.releases WHERE id=NEW.release_id;
  IF NOT FOUND OR source.project_id<>NEW.project_id OR source.service_id<>NEW.service_id THEN RAISE EXCEPTION 'Journey release ownership mismatch' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='release_journeys' THEN
    IF NEW.body->'snapshot'->>'tag' IS DISTINCT FROM source.tag OR NEW.body->'snapshot'->>'branch' IS DISTINCT FROM source.branch
      OR NEW.body->'snapshot'->>'commitSha' IS DISTINCT FROM source.commit_sha THEN RAISE EXCEPTION 'Journey source mismatch' USING ERRCODE='55000'; END IF;
  ELSE
    SELECT * INTO parent FROM release.release_journeys WHERE id=NEW.journey_id FOR UPDATE;
    IF NOT FOUND OR parent.project_id<>NEW.project_id OR parent.service_id<>NEW.service_id OR parent.release_id<>NEW.release_id
      OR NEW.sequence<>parent.revision+1 OR parent.status IN ('succeeded','failed','interrupted') THEN RAISE EXCEPTION 'Journey event parent mismatch' USING ERRCODE='55000'; END IF;
    IF NEW.body->>'handoffId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM release.execution_handoffs h WHERE h.id=NEW.body->>'handoffId'
      AND h.service_id=NEW.service_id AND h.body->>'projectId'=NEW.project_id AND h.body->>'targetReleaseId'=NEW.release_id AND h.body->>'journeyId'=NEW.journey_id) THEN
      RAISE EXCEPTION 'Journey event handoff ownership mismatch' USING ERRCODE='55000'; END IF;
    IF NEW.body->>'trafficSwitchId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM release.traffic_switches s WHERE s.id=NEW.body->>'trafficSwitchId' AND s.service_id=NEW.service_id AND s.release_id=NEW.release_id)
      AND NOT EXISTS (SELECT 1 FROM release.execution_handoffs h WHERE h.id=NEW.body->>'trafficSwitchId' AND h.service_id=NEW.service_id
        AND h.body->>'projectId'=NEW.project_id AND h.body->>'targetReleaseId'=NEW.release_id AND h.body->>'journeyId'=NEW.journey_id) THEN
      RAISE EXCEPTION 'Journey event traffic switch ownership mismatch' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION release.guard_handoff_journey() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent release.release_journeys; BEGIN
  IF TG_OP='UPDATE' AND OLD.body->'journeyId' IS DISTINCT FROM NEW.body->'journeyId' THEN
    RAISE EXCEPTION 'Handoff journey birth is immutable' USING ERRCODE='55000'; END IF;
  IF NEW.body->>'journeyId' IS NOT NULL THEN
    SELECT * INTO parent FROM release.release_journeys WHERE id=NEW.body->>'journeyId';
    IF NOT FOUND OR parent.project_id IS DISTINCT FROM NEW.body->>'projectId' OR parent.service_id<>NEW.service_id
      OR parent.release_id IS DISTINCT FROM NEW.body->>'targetReleaseId' THEN
      RAISE EXCEPTION 'Handoff journey ownership mismatch' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER release_handoff_journey_guard BEFORE INSERT OR UPDATE ON release.execution_handoffs
  FOR EACH ROW EXECUTE FUNCTION release.guard_handoff_journey();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['release_journeys','release_journey_events'] LOOP
    EXECUTE format('CREATE TRIGGER release_project_content_guard BEFORE INSERT OR UPDATE OR DELETE ON release.%I FOR EACH ROW EXECUTE FUNCTION release.guard_project_content()',name);
    EXECUTE format('CREATE TRIGGER release_journey_content_guard BEFORE INSERT OR UPDATE OR DELETE ON release.%I FOR EACH ROW EXECUTE FUNCTION release.guard_journey_content()',name);
    EXECUTE format('CREATE TRIGGER release_project_truncate_guard BEFORE TRUNCATE ON release.%I FOR EACH STATEMENT EXECUTE FUNCTION release.reject_content_truncate()',name);
  END LOOP;
END $$;
