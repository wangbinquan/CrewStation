-- Original parent endings (0019) are already published and immutable.
-- 0019 already owns the binding column. Add only its generated SQL-kind witnesses.
-- SQL NULL is legacy absence; explicit JSON null/string/invalid presence stays selected.
ALTER TABLE task_runtime.environment_rebuilds
  ADD COLUMN development_parent_binding_present boolean GENERATED ALWAYS AS (development_parent_binding IS NOT NULL) STORED,
  ADD COLUMN development_parent_binding_kind text GENERATED ALWAYS AS (jsonb_typeof(development_parent_binding)) STORED;
