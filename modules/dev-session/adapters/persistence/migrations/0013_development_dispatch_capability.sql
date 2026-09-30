-- RFC-034: persist original advertised capability before reading an unavailable Runner journal.
-- NULL preserves old owner payloads; observed support is monotonic and tied to the actual original Pod.
ALTER TABLE dev_session.development_agent_usage ADD COLUMN capability_pod_uid text;
ALTER TABLE dev_session.development_agent_usage ADD CONSTRAINT development_agent_usage_capability
  CHECK (capability_pod_uid IS NULL OR (length(capability_pod_uid) BETWEEN 1 AND 128 AND NOT unsupported));
