-- Keep the original completion witness immutable. The sole successor is a
-- strictly shaped, append-once receipt for the already committed D9 retirement.
CREATE OR REPLACE FUNCTION task_runtime.guard_parent_ending_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  receipt jsonb;
  resource_receipt jsonb;
  digest_key text;
  retired_at_value timestamptz;
  completed_at_value timestamptz;
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
    IF (OLD.status = 'complete' AND OLD.membership_frozen AND
        OLD.completion_witness->>'outcome' = 'compensation' AND
        (to_jsonb(NEW)-'progress') = (to_jsonb(OLD)-'progress')) IS NOT TRUE THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    IF jsonb_typeof(OLD.progress) IS DISTINCT FROM 'object' OR
       jsonb_typeof(NEW.progress) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    IF OLD.progress ? 'retentionTransition' OR
       (NEW.progress ? 'retentionTransition' AND
        (NEW.progress-'retentionTransition') = OLD.progress) IS NOT TRUE THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    receipt := NEW.progress->'retentionTransition';
    IF jsonb_typeof(receipt) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    IF (receipt ?& ARRAY['version','endingId','epochHash','sourceCompletionWitnessHash',
        'beforeTransitionHash','afterTransitionHash','runnerTokenHash','retiredAt','resource'] AND
        (SELECT count(*) FROM jsonb_object_keys(receipt)) = 9 AND
        receipt->'version' = '1'::jsonb AND
        jsonb_typeof(receipt->'endingId') = 'string' AND receipt->>'endingId' = OLD.id AND
        receipt->>'epochHash' = OLD.epoch_hash AND
        receipt->>'beforeTransitionHash' = OLD.completion_witness->>'afterTransitionHash' AND
        receipt->>'runnerTokenHash' = OLD.completion_witness->>'runnerTokenHash') IS NOT TRUE THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    FOREACH digest_key IN ARRAY ARRAY['epochHash','sourceCompletionWitnessHash',
        'beforeTransitionHash','afterTransitionHash','runnerTokenHash'] LOOP
      IF (jsonb_typeof(receipt->digest_key) = 'string' AND
          receipt->>digest_key ~ '^[a-f0-9]{64}$') IS NOT TRUE THEN
        RAISE EXCEPTION 'development parent completion witness is immutable';
      END IF;
    END LOOP;
    resource_receipt := receipt->'resource';
    IF jsonb_typeof(resource_receipt) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    IF (resource_receipt ?& ARRAY['id','projectId','ownerRef','kind','generation',
        'specHash','retainUntil','releaseReason'] AND
        (SELECT count(*) FROM jsonb_object_keys(resource_receipt)) = 8 AND
        jsonb_typeof(resource_receipt->'id') = 'string' AND resource_receipt->>'id' = OLD.parent_id AND
        jsonb_typeof(resource_receipt->'projectId') = 'string' AND resource_receipt->>'projectId' = OLD.project_id AND
        jsonb_typeof(resource_receipt->'ownerRef') = 'string' AND resource_receipt->>'ownerRef' = OLD.parent_id AND
        resource_receipt->'kind' = '"dev-workspace"'::jsonb AND
        jsonb_typeof(resource_receipt->'generation') = 'number' AND
        resource_receipt->>'generation' ~ '^[1-9][0-9]{0,15}$' AND
        jsonb_typeof(resource_receipt->'specHash') = 'string' AND
        resource_receipt->>'specHash' ~ '^[a-f0-9]{64}$' AND
        resource_receipt->'retainUntil' = 'null'::jsonb AND
        resource_receipt->'releaseReason' = '"retention-expired"'::jsonb) IS NOT TRUE THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    IF (resource_receipt->>'generation')::numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    IF (jsonb_typeof(receipt->'retiredAt') = 'string' AND
        receipt->>'retiredAt' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?Z$' AND
        jsonb_typeof(OLD.completion_witness->'completedAt') = 'string') IS NOT TRUE THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
    BEGIN
      retired_at_value := (receipt->>'retiredAt')::timestamptz;
      completed_at_value := (OLD.completion_witness->>'completedAt')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END;
    IF (retired_at_value >= completed_at_value) IS NOT TRUE THEN
      RAISE EXCEPTION 'development parent completion witness is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
