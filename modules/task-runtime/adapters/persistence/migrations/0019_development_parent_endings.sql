ALTER TABLE task_runtime.environments ADD COLUMN parent_ending jsonb;
-- JSON null is malformed presence, distinct from SQL NULL (no selection). All query mappers retain this fact.
ALTER TABLE task_runtime.environments ADD COLUMN parent_ending_present boolean GENERATED ALWAYS AS (parent_ending IS NOT NULL) STORED;
ALTER TABLE task_runtime.environments ADD COLUMN parent_ending_kind text GENERATED ALWAYS AS (jsonb_typeof(parent_ending)) STORED;
ALTER TABLE task_runtime.environment_rebuilds ADD COLUMN development_parent_binding jsonb;

CREATE TABLE task_runtime.development_parent_endings (
  id text PRIMARY KEY,
  parent_id text NOT NULL,
  project_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('release', 'rebuild', 'retention', 'compensation')),
  epoch jsonb NOT NULL CHECK (jsonb_typeof(epoch) = 'object'),
  epoch_hash text NOT NULL CHECK (epoch_hash ~ '^[a-f0-9]{64}$'),
  selection_hash text NOT NULL CHECK (selection_hash ~ '^[a-f0-9]{64}$'),
  intent jsonb NOT NULL CHECK (jsonb_typeof(intent) = 'object'),
  phase text NOT NULL CHECK (phase IN ('admission-sealed', 'children', 'prepared', 'stop-intent', 'proved', 'complete')),
  status text NOT NULL CHECK (status IN ('pending', 'blocked', 'complete')),
  membership_revision integer NOT NULL DEFAULT 1 CHECK (membership_revision = 1),
  member_count bigint NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  membership_frozen boolean NOT NULL DEFAULT false,
  after_child_id text,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progress) = 'object'),
  completion_witness jsonb,
  message text,
  retry_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((phase = 'complete') = (status = 'complete')),
  CHECK ((completion_witness IS NOT NULL) = (phase = 'complete'))
);
CREATE UNIQUE INDEX development_parent_ending_active_epoch ON task_runtime.development_parent_endings (parent_id, epoch_hash) WHERE phase <> 'complete';
CREATE INDEX development_parent_ending_due ON task_runtime.development_parent_endings (id, retry_at) WHERE status <> 'complete';

CREATE TABLE task_runtime.development_parent_ending_children (
  ending_id text NOT NULL REFERENCES task_runtime.development_parent_endings (id),
  child_id text NOT NULL,
  original_parent_pod_uid text,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  closed boolean NOT NULL DEFAULT false,
  closure jsonb,
  PRIMARY KEY (ending_id, child_id),
  CHECK (closed = (closure IS NOT NULL))
);
CREATE INDEX development_parent_children_pending ON task_runtime.development_parent_ending_children (ending_id, child_id) WHERE NOT closed;
CREATE INDEX environments_parent_epoch_lookup ON task_runtime.environments ((native->>'parentTaskId'), (native->>'parentPodUid'), id) WHERE native IS NOT NULL;

CREATE TABLE task_runtime.development_parent_ending_objects (
  ending_id text NOT NULL REFERENCES task_runtime.development_parent_endings (id),
  kind text NOT NULL CHECK (kind IN ('Pod', 'Secret')),
  namespace text NOT NULL,
  name text NOT NULL,
  uid text NOT NULL,
  materials_hash text NOT NULL CHECK (materials_hash ~ '^[a-f0-9]{64}$'),
  absence jsonb,
  PRIMARY KEY (ending_id, kind, namespace, name)
);
CREATE INDEX development_parent_object_lookup ON task_runtime.development_parent_ending_objects (kind, namespace, name);

CREATE TABLE task_runtime.development_parent_rebuild_claims (
  source_ending_id text PRIMARY KEY REFERENCES task_runtime.development_parent_endings (id),
  current_rebuild_id text NOT NULL UNIQUE,
  revision bigint NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  after_transition_hash text NOT NULL CHECK (after_transition_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'published', 'released')),
  retry_at timestamptz NOT NULL
);
CREATE INDEX development_parent_claim_due ON task_runtime.development_parent_rebuild_claims (source_ending_id, retry_at) WHERE state = 'pending';

CREATE TABLE task_runtime.development_parent_recovery_sweep (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  kind text NOT NULL CHECK (kind IN ('ending', 'claim')),
  scan_cutoff timestamptz NOT NULL,
  after_id text,
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0)
);

CREATE FUNCTION task_runtime.guard_parent_ending_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.parent_id, NEW.project_id, NEW.operation, NEW.epoch, NEW.epoch_hash, NEW.selection_hash, NEW.intent, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.parent_id, OLD.project_id, OLD.operation, OLD.epoch, OLD.epoch_hash, OLD.selection_hash, OLD.intent, OLD.created_at) THEN
    RAISE EXCEPTION 'development parent ending identity is immutable';
  END IF;
  IF OLD.membership_frozen AND ROW(NEW.membership_revision, NEW.member_count, NEW.membership_frozen)
    IS DISTINCT FROM ROW(OLD.membership_revision, OLD.member_count, OLD.membership_frozen) THEN
    RAISE EXCEPTION 'development parent ending membership is immutable';
  END IF;
  IF OLD.phase = 'complete' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'development parent completion witness is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER development_parent_ending_identity BEFORE UPDATE ON task_runtime.development_parent_endings FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_parent_ending_identity();

CREATE FUNCTION task_runtime.guard_parent_child_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.ending_id, NEW.child_id, NEW.original_parent_pod_uid, NEW.snapshot)
    IS DISTINCT FROM ROW(OLD.ending_id, OLD.child_id, OLD.original_parent_pod_uid, OLD.snapshot) OR (OLD.closed AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'development parent original child identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER development_parent_child_identity BEFORE UPDATE ON task_runtime.development_parent_ending_children FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_parent_child_identity();

CREATE FUNCTION task_runtime.guard_parent_object_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.ending_id, NEW.kind, NEW.namespace, NEW.name, NEW.uid, NEW.materials_hash)
    IS DISTINCT FROM ROW(OLD.ending_id, OLD.kind, OLD.namespace, OLD.name, OLD.uid, OLD.materials_hash) OR (OLD.absence IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'development parent original object identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER development_parent_object_identity BEFORE UPDATE ON task_runtime.development_parent_ending_objects FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_parent_object_identity();

-- The frozen set is permanent; neither a late insert nor deletion may change the complete member count.
CREATE FUNCTION task_runtime.guard_parent_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen boolean;
DECLARE ending_key text;
BEGIN
  IF TG_OP = 'DELETE' THEN ending_key := OLD.ending_id; ELSE ending_key := NEW.ending_id; END IF;
  SELECT membership_frozen INTO frozen FROM task_runtime.development_parent_endings
    WHERE id = ending_key FOR UPDATE;
  IF frozen THEN RAISE EXCEPTION 'development parent fixed membership cannot change'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER development_parent_fixed_membership BEFORE INSERT OR DELETE ON task_runtime.development_parent_ending_children FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_parent_membership();

-- Physical original identities are first recorded only after the complete child set closes.
CREATE FUNCTION task_runtime.guard_parent_object_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_phase text;
BEGIN
  SELECT phase INTO original_phase FROM task_runtime.development_parent_endings WHERE id=NEW.ending_id FOR UPDATE;
  IF original_phase <> 'children' OR EXISTS (SELECT 1 FROM task_runtime.development_parent_ending_children WHERE ending_id=NEW.ending_id AND NOT closed) THEN
    RAISE EXCEPTION 'development parent original physical preparation is not available';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER development_parent_object_admission BEFORE INSERT ON task_runtime.development_parent_ending_objects FOR EACH ROW EXECUTE FUNCTION task_runtime.guard_parent_object_admission();
