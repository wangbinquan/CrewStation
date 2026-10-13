CREATE TABLE observability.runtime_projection_scopes(project_id text PRIMARY KEY,revision numeric NOT NULL DEFAULT 0,as_of text);
INSERT INTO observability.runtime_projection_scopes SELECT project_id,1,max(document->>'capturedAt') FROM observability.runtime_task_cache GROUP BY project_id;
