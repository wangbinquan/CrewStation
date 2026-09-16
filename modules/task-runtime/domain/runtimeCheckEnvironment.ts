import type { ProjectId, ServiceId } from '@crewstation/contracts';

/**
 * 管理员运行环境检查的平台专属任务（RFC-004 §7）：跑在系统命名空间，不属于任何租户项目。
 * 用固定的哨兵项目 ID 复用配额准入表，从而给并发检查一个上限；它不是真实项目，不能出现在租户查询里。
 */
export const RUNTIME_CHECK_PROJECT_ID = 'prj_00000000000000000000000000000001' as ProjectId;
export const RUNTIME_CHECK_SERVICE_ID = 'svc_00000000000000000000000000000001' as ServiceId;
export const RUNTIME_CHECK_MAX_CONCURRENT = 4;
export const RUNTIME_CHECK_LABELS = { project: 'platform', service: 'runtime-check' } as const;

/** 检查任务用固定的 Agent 标识与档位名回显，便于在事件里识别。 */
export const RUNTIME_CHECK_COMPUTE = 'runtime-check';
export const runtimeCheckAgentId = (checkId: string): string => `chk-${checkId.slice(-12)}`;
