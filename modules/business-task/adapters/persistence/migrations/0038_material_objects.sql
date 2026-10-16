ALTER TABLE business_task.execution_materials ADD COLUMN state text NOT NULL DEFAULT 'ready' CHECK (state IN ('preparing', 'ready'));
