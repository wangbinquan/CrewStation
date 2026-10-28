ALTER TABLE gateway.database_restore_maintenance ADD COLUMN operation_kind text NOT NULL DEFAULT 'restore' CHECK(operation_kind IN ('restore','migration'));
