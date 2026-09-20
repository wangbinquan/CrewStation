ALTER TABLE api_catalog.proxies ADD COLUMN id text;
ALTER TABLE api_catalog.proxies ADD COLUMN name text;
UPDATE api_catalog.proxies SET name = proxy;
ALTER TABLE api_catalog.operations ADD COLUMN id text;
ALTER TABLE api_catalog.operations ADD COLUMN proxy_id text;
UPDATE api_catalog.operations SET proxy_id = proxy;
