-- RFC-034: retain the original anchor for already-entered old writers; all new receipts are independent.
SELECT pg_advisory_xact_lock(hashtextextended('observability.runtime-reports',0));
CREATE TABLE observability.runtime_report_revisions(revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY CHECK(revision>0));
CREATE OR REPLACE FUNCTION observability.advance_runtime_report_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO observability.runtime_report_revisions DEFAULT VALUES; RETURN NULL; END $$;
-- Physical cache parents fence delayed pre-migration publication; original source data is retained.
DELETE FROM observability.runtime_reports;
