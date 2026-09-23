-- RFC-022：环境最近一次启动的阶段进度（受理、建 Pod、调度与拉镜像、检出、连上）。升级前创建的环境为空，不回填。
ALTER TABLE task_runtime.environments ADD COLUMN IF NOT EXISTS startup jsonb;
-- 观测用例每秒只取启动中的环境。
CREATE INDEX IF NOT EXISTS environments_starting ON task_runtime.environments (id) WHERE (startup->>'state') = 'running';
