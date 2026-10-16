-- RFC-042 review: production access during a restore reservation is refused by the application with
-- database_restore_active, and a request pinned to an older generation by database_generation_changed;
-- the trigger only turned the same rules into HTTP 500 for racing or late requests.
DROP TRIGGER production_binding_generation ON data.task_bindings;
DROP FUNCTION data.guard_production_binding_generation();
