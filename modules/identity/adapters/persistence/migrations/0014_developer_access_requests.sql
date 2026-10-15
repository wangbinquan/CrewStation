CREATE TABLE identity.developer_access_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES identity.users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected')),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  reviewer_id text REFERENCES identity.users(id),
  note text,
  CHECK ((state = 'pending' AND reviewed_at IS NULL AND reviewer_id IS NULL AND note IS NULL) OR
         (state <> 'pending' AND reviewed_at IS NOT NULL AND reviewer_id IS NOT NULL AND note IS NOT NULL))
);
CREATE UNIQUE INDEX developer_access_pending_uq ON identity.developer_access_requests(user_id) WHERE state = 'pending';
CREATE INDEX developer_access_user_idx ON identity.developer_access_requests(user_id, id);
CREATE INDEX developer_access_state_idx ON identity.developer_access_requests(state, id);
