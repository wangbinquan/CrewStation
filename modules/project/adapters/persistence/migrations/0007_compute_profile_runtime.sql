-- RFC-004：算力档位可绑定管理员运行环境；revision 供写操作做版本比较。
ALTER TABLE project.compute_profiles ADD COLUMN runtime_config_id text;
ALTER TABLE project.compute_profiles ADD COLUMN revision integer NOT NULL DEFAULT 0;
