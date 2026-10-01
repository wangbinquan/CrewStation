-- 原 Pod UID 同时覆盖服务、开发、业务任务和平台进程；历史已签名来源可以无损回填。
ALTER TABLE gateway.pod_identities ADD COLUMN pod_uid text;
UPDATE gateway.pod_identities SET pod_uid=coalesce(service_source->>'podUid',development_source->>'podUid');
