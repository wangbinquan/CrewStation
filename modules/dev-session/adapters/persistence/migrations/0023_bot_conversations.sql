CREATE TABLE dev_session.bot_conversations (
  task_id text PRIMARY KEY,
  id text NOT NULL UNIQUE,
  revision integer NOT NULL CHECK (revision > 0),
  data jsonb NOT NULL
);
CREATE TABLE dev_session.bot_messages (
  task_id text NOT NULL REFERENCES dev_session.bot_conversations(task_id),
  request_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('accepted', 'dispatched', 'unknown', 'rejected')),
  data jsonb NOT NULL
);
CREATE UNIQUE INDEX bot_messages_request ON dev_session.bot_messages(task_id, request_id);
CREATE INDEX bot_messages_pending ON dev_session.bot_messages(task_id, state);
CREATE TABLE dev_session.bot_executions (
  agent_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES dev_session.bot_conversations(task_id),
  execution_task_id text NOT NULL UNIQUE,
  data jsonb NOT NULL
);
CREATE INDEX bot_executions_task ON dev_session.bot_executions(task_id, agent_id);

-- Project deletion fencing applies to durable Bot metadata and late reconciler writes too.
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['bot_conversations','bot_messages','bot_executions'] LOOP
 EXECUTE format('CREATE TRIGGER development_all_content_guard BEFORE INSERT OR UPDATE OR DELETE ON dev_session.%I FOR EACH ROW EXECUTE FUNCTION dev_session.guard_all_content()',table_name);
 EXECUTE format('CREATE TRIGGER development_all_content_truncate BEFORE TRUNCATE ON dev_session.%I FOR EACH STATEMENT EXECUTE FUNCTION dev_session.reject_work_truncate()',table_name);
 END LOOP;
END $$;
