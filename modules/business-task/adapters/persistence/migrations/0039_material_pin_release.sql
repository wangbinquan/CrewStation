-- RFC-040: material-version object pins are released after the parent closes or after the
-- last attempt that used the material has been terminal for the business retention period.
-- Existing rows are not rewritten (content guards stay untouched): object_count NULL means
-- "admitted before this migration", and a NULL pinned_at falls back to created_at.
ALTER TABLE business_task.execution_materials DROP CONSTRAINT execution_materials_state_check;
ALTER TABLE business_task.execution_materials ADD CONSTRAINT execution_materials_state_check CHECK (state IN ('preparing', 'ready', 'releasing', 'released'));
ALTER TABLE business_task.execution_materials ADD COLUMN pin_revision integer NOT NULL DEFAULT 1 CHECK (pin_revision > 0);
ALTER TABLE business_task.execution_materials ADD COLUMN object_count integer CHECK (object_count >= 0);
ALTER TABLE business_task.execution_materials ADD COLUMN pinned_at timestamptz;
-- Object-file descriptors have their own 4 MiB budget beside the 1 MiB inline envelope.
ALTER TABLE business_task.execution_materials DROP CONSTRAINT execution_materials_size_bytes_check;
ALTER TABLE business_task.execution_materials ADD CONSTRAINT execution_materials_size_bytes_check CHECK (size_bytes >= 0 AND size_bytes <= 5242880);
CREATE INDEX execution_materials_release ON business_task.execution_materials (created_at) WHERE state <> 'released';
