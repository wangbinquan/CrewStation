CREATE TABLE dev_session.workspace_layouts (
  task_id text NOT NULL,
  user_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
