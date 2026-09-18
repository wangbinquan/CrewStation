-- RFC-006：运行环境检查改名为档位测试；记录 Runner 握手被拒的原因（旧底座镜像的协议不一致）。
UPDATE task_runtime.environments SET kind = 'profile-test' WHERE kind = 'runtime-check';
UPDATE task_runtime.environments SET release = jsonb_set(release, '{reason}', '"profile-test"') WHERE release->>'reason' = 'runtime-check';
ALTER TABLE task_runtime.environments ADD COLUMN runner_rejection jsonb;
