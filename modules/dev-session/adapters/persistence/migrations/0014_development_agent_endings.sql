-- RFC-034: owner-private logical ending, durable evidence and bounded fair recovery.
-- Existing public AgentStart/owner payloads omit these flags; old executions remain legacy.
ALTER TABLE dev_session.agent_starts ADD COLUMN logical_ending boolean NOT NULL DEFAULT false;
ALTER TABLE dev_session.development_agent_usage ADD COLUMN ending_checked_at text;
CREATE TABLE dev_session.development_agent_endings (
  execution_task_id text PRIMARY KEY REFERENCES dev_session.development_agent_usage(execution_task_id),
  first_reason text NOT NULL CHECK (first_reason IN ('completed','error','cancelled','workspace-released','forced-release','environment-lost')),
  observed_at text NOT NULL,
  logical_result text CHECK (logical_result IN ('completed','error','cancelled')),
  actual_ended_at text CHECK (actual_ended_at IS NULL),
  version integer NOT NULL CHECK (version > 0),
  fence integer NOT NULL CHECK (fence >= 0),
  lease_until text,
  last_attempt_at text NOT NULL,
  stop jsonb, closure jsonb,
  stage text NOT NULL CHECK (stage IN ('awaiting-stop','awaiting-closure','evidence-complete'))
);
CREATE INDEX development_agent_endings_pending ON dev_session.development_agent_endings(stage, last_attempt_at, execution_task_id);
CREATE INDEX development_agent_usage_ending_scan ON dev_session.development_agent_usage(ending_checked_at, accepted_at, execution_task_id);
