-- 档位测试准入仍使用哨兵计数器；资源台账模式旧 release 未退该计数。
-- 仅修复平台哨兵。保留所有活动／清理中的环境以及用途验证尚未确认释放的容量。
UPDATE task_runtime.admissions
SET running = (
  SELECT count(*) FROM task_runtime.environments
  WHERE kind = 'profile-test'
    AND project_id = '01a0bf5d-8f4b-7006-9d13-970deb06320c'
    AND (state IN ('creating', 'running', 'releasing')
      OR render->'runtimeValidation'->>'quotaHeld' = 'true')
)
WHERE project_id = '01a0bf5d-8f4b-7006-9d13-970deb06320c';
