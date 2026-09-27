ALTER TABLE business_task.legacy_mutations ADD COLUMN parent_id text;
ALTER TABLE business_task.legacy_mutations ADD COLUMN owner_pod_uid text;
CREATE INDEX legacy_mutation_children ON business_task.legacy_mutations(parent_id) WHERE state <> 'complete';
