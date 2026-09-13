CREATE INDEX requests_page_idx ON api_catalog.requests (created_at DESC, id DESC);
CREATE INDEX requests_state_page_idx ON api_catalog.requests (state, created_at DESC, id DESC);
CREATE INDEX requests_project_page_idx ON api_catalog.requests (project_id, created_at DESC, id DESC);
CREATE INDEX requests_project_state_page_idx ON api_catalog.requests (project_id, state, created_at DESC, id DESC);
