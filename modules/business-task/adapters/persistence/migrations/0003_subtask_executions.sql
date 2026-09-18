-- RFC-006 §5.4：Agent 子任务各自一个执行环境（Pod）；按执行环境 taskId 查子任务、找待派发与待回收的子任务。
CREATE INDEX IF NOT EXISTS subtasks_execution ON business_task.subtasks ((spec->'execution'->>'taskId')) WHERE spec->'execution' IS NOT NULL;
