import type { ProjectId, ServiceId } from '@crewstation/contracts';

/**
 * 管理员档位测试的平台专属任务（RFC-006 §6）：跑在系统命名空间，不属于任何租户项目。
 * 用固定的哨兵项目 ID 复用配额准入表，从而给并发测试一个上限；它不是真实项目，不能出现在租户查询里。
 * 哨兵 ID 沿用 RFC-004 运行环境检查的取值，准入计数行随之延续。
 */
export const PROFILE_TEST_PROJECT_ID = 'prj_00000000000000000000000000000001' as ProjectId;
export const PROFILE_TEST_SERVICE_ID = 'svc_00000000000000000000000000000001' as ServiceId;
export const PROFILE_TEST_MAX_CONCURRENT = 4;
export const PROFILE_TEST_LABELS = { project: 'platform', service: 'profile-test' } as const;

/** 测试用固定的 Agent 标识，便于在事件里识别；通用终端的 probeId 取同一个值。 */
export const profileTestAgentId = (testId: string): string => `pft-${testId.slice(-12)}`;
