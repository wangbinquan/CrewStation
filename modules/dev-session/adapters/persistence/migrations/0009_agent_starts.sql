-- RFC-006：headless Agent 各自一个执行环境（Pod）；受理记录固定档位修订与执行环境身份，后台按记录派发与回收。
CREATE TABLE IF NOT EXISTS dev_session.agent_starts (
  agent_id text PRIMARY KEY,
  task_id text NOT NULL,
  created_by text NOT NULL,
  compute text NOT NULL,
  profile jsonb NOT NULL,
  permission text NOT NULL,
  request jsonb NOT NULL,
  execution jsonb NOT NULL,
  execution_task_id text NOT NULL,
  state text NOT NULL,
  failure text,
  cancelled boolean NOT NULL DEFAULT false,
  cursor integer NOT NULL DEFAULT 0,
  finalized boolean NOT NULL DEFAULT false,
  created_at text NOT NULL,
  dispatched_at text,
  ended_at text
);
CREATE INDEX IF NOT EXISTS agent_starts_task ON dev_session.agent_starts (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_starts_execution ON dev_session.agent_starts (execution_task_id);
CREATE INDEX IF NOT EXISTS agent_starts_open ON dev_session.agent_starts (agent_id) WHERE NOT finalized;
