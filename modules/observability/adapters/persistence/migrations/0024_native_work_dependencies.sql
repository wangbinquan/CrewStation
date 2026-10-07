-- Metadata revision only; original Token/CNY and sync watermarks are unchanged.
ALTER TABLE observability.usage_heads ADD COLUMN native_revision text NOT NULL DEFAULT '0' CHECK(native_revision~'^(0|[1-9][0-9]*)$');
