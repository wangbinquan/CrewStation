-- RFC-025 I25：资源中心照它建出这个环境的容器（Pod、Runner Secret、开发预览的 Service 与路由；工作卷另有一条记录）。
-- 不含凭据：凭据在调和器建 Runner Secret 时由 task-runtime 当场给出，不落库。之前受理的环境为空，照旧由 task-runtime 自己建。
ALTER TABLE task_runtime.environments ADD COLUMN IF NOT EXISTS render jsonb;
