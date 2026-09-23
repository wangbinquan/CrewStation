import type { Actor, ProjectId } from '@crewstation/contracts';

/** 项目的并发任务额度上限（D31），由组合根从 project 模块取；没有配置返回 undefined。 */
export interface QuotaLimits {
  limitFor(projectId: ProjectId): Promise<number | undefined>;
}

/** 视图、推送流与可做操作的授权，由组合根按 project 模块的成员与角色回答。 */
export interface ResourceAuthorizer {
  /** 没有 view 权限时抛 forbidden／not_found；operate 表示有 develop 权限，可以做生命周期操作。 */
  projectAccess(actor: Actor, projectId: ProjectId): Promise<{ readonly operate: boolean }>;
}
