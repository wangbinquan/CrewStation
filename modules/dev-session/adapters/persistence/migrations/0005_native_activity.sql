CREATE TABLE dev_session.native_activity_progress (
  task_id text PRIMARY KEY,
  through_seq bigint NOT NULL DEFAULT 0,
  pruned_through_seq bigint NOT NULL DEFAULT 0
);
CREATE TABLE dev_session.native_activity_states (
  task_id text NOT NULL,
  agent_id text NOT NULL,
  projection jsonb NOT NULL,
  PRIMARY KEY (task_id, agent_id)
);
CREATE TABLE dev_session.native_activity_items (
  task_id text NOT NULL,
  seq bigint NOT NULL,
  event_id text NOT NULL,
  agent_id text NOT NULL,
  turn_id text,
  kind text NOT NULL,
  item jsonb NOT NULL,
  PRIMARY KEY (task_id, seq)
);
CREATE UNIQUE INDEX native_activity_event ON dev_session.native_activity_items (task_id, event_id);
CREATE INDEX native_activity_turn ON dev_session.native_activity_items (task_id, agent_id, turn_id, seq);
CREATE TABLE dev_session.native_activity_reads (
  task_id text NOT NULL,
  user_id text NOT NULL,
  agent_id text NOT NULL,
  turn_id text NOT NULL,
  through_seq bigint NOT NULL,
  PRIMARY KEY (task_id, user_id, agent_id, turn_id)
);
