-- Only new explicit registrations select protection; legacy null rows are never backfilled.
ALTER TABLE resources.workload_consumers ADD COLUMN development_admission jsonb;
