CREATE TABLE IF NOT EXISTS dev_session.idle_reminders (
  task_id text PRIMARY KEY,
  last_reminder_at timestamptz NOT NULL
);
