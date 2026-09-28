-- RFC-035: raw event retention must not erase durable completion evidence.
-- Legacy executions are not silently upgraded; evidence is created by the consumer handshake.
CREATE TABLE session.execution_completion_proofs (
  task_id text NOT NULL,
  execution_id text NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (task_id, execution_id)
);
