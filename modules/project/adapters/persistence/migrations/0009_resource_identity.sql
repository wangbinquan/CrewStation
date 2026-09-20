-- Expand before the coordinated, transactional reference conversion (RFC-013).
ALTER TABLE project.service_plans ADD COLUMN id text;
ALTER TABLE project.task_profiles ADD COLUMN id text;
INSERT INTO project.service_plans (name, cpu, memory, max_replicas, description)
VALUES ('standard-small', '500m', '512Mi', 3, '默认服务套餐') ON CONFLICT (name) DO NOTHING;
INSERT INTO project.task_profiles (name, cpu, memory, storage, description)
VALUES ('coding-medium', '1', '2Gi', '10Gi', '默认任务规格') ON CONFLICT (name) DO NOTHING;
