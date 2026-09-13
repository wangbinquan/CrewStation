CREATE INDEX requests_page_idx ON egress.requests (created_at DESC, id DESC);
CREATE INDEX requests_state_page_idx ON egress.requests (state, created_at DESC, id DESC);
CREATE INDEX requests_project_page_idx ON egress.requests (project_id, created_at DESC, id DESC);
CREATE INDEX requests_project_state_page_idx ON egress.requests (project_id, state, created_at DESC, id DESC);
