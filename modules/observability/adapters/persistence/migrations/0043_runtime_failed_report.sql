-- Persist an explicit preparation/directory failure; never leave it building.
ALTER TABLE observability.runtime_lazy_reports DROP CONSTRAINT runtime_lazy_reports_state_check;
ALTER TABLE observability.runtime_lazy_reports ADD CONSTRAINT runtime_lazy_reports_state_check CHECK(state IN('building','not-ready','ready','failed'));
