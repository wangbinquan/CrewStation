-- Preserve the original queue and expose failed bootstrap without publishing partial task populations.
ALTER TABLE observability.runtime_task_bootstrap ADD COLUMN last_error text;
ALTER TABLE observability.runtime_task_bootstrap ADD COLUMN failed_at timestamptz;
