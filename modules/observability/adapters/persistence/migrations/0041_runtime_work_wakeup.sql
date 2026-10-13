-- A genuinely new committed change wakes its existing task immediately; unchanged retries still yield.

CREATE OR REPLACE FUNCTION observability.dirty_runtime_metadata(target text,project text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO observability.runtime_task_work(key,project_id,requires_full) VALUES(target,project,false) ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),polled_at=least(observability.runtime_task_work.polled_at,clock_timestamp()-interval '2 seconds'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id);
 INSERT INTO observability.runtime_task_metadata_work VALUES(target) ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION observability.dirty_runtime_proof(target text,project text,kind text,original_key text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO observability.runtime_task_work(key,project_id,requires_full) VALUES(target,project,false) ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),polled_at=least(observability.runtime_task_work.polled_at,clock_timestamp()-interval '2 seconds'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id);
 INSERT INTO observability.runtime_task_proof_work VALUES(target,kind,original_key) ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION observability.dirty_runtime_self_record(target text,project text,meter text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO observability.runtime_task_work(key,project_id,requires_full) VALUES(target,project,false) ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),polled_at=least(observability.runtime_task_work.polled_at,clock_timestamp()-interval '2 seconds'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id);
 INSERT INTO observability.runtime_task_record_work(task_id,meter_key) VALUES(target,meter) ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION observability.dirty_runtime_task(key text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO observability.runtime_task_work(key) SELECT key WHERE key IS NOT NULL AND length(key)>0
 ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),polled_at=least(observability.runtime_task_work.polled_at,clock_timestamp()-interval '2 seconds')
$$;

CREATE OR REPLACE FUNCTION observability.dirty_runtime_task_project(key text,project text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO observability.runtime_task_work(key,project_id,requires_full) SELECT key,project,true WHERE key IS NOT NULL AND length(key)>0 ON CONFLICT(key) DO UPDATE SET revision=nextval('observability.runtime_task_change_sequence'),polled_at=least(observability.runtime_task_work.polled_at,clock_timestamp()-interval '2 seconds'),project_id=coalesce("excluded"."project_id",observability.runtime_task_work.project_id),requires_full=true
$$;
