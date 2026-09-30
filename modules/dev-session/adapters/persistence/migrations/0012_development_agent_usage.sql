-- RFC-034: owner-only stable intent and frozen CNY admission, isolated from ordinary AgentStart updates.
CREATE TABLE dev_session.development_agent_usage (
  execution_task_id text PRIMARY KEY REFERENCES dev_session.agent_starts(execution_task_id),
  project_id text NOT NULL,
  workspace_task_id text NOT NULL,
  accepted_at text NOT NULL,
  prepared jsonb NOT NULL,
  binding jsonb,
  unsupported boolean NOT NULL DEFAULT false,
  close_reason text
);
CREATE INDEX development_agent_usage_cohort ON dev_session.development_agent_usage (project_id, accepted_at, execution_task_id);
