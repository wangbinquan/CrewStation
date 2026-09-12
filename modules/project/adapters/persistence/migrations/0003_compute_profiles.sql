-- 算力档位（RFC-001）：管理员定义，Manifest 与开发会话按名引用。
-- 与 service_plans / task_profiles 同构：名字是主键，业务只引用名字。
CREATE TABLE IF NOT EXISTS project.compute_profiles (
  name text PRIMARY KEY,
  driver text NOT NULL,
  model text NOT NULL,
  description text NOT NULL DEFAULT ''
);
