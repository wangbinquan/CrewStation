CREATE TABLE gateway.rate_limit_receipts (operation_id text PRIMARY KEY, project_id text NOT NULL, body jsonb NOT NULL);
