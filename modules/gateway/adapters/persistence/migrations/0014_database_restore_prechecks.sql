-- RFC-042 review: owner maintenance edits during a restore hold are refused by the application with
-- database_restore_maintenance_held; the trigger surfaced the same rule as HTTP 500. The hold row keeps
-- its own identity guards; its revision fence still serializes against concurrent edits.
DROP TRIGGER gateway_restore_maintenance_guard ON gateway.service_maintenance;
DROP FUNCTION gateway.guard_restore_maintenance();
