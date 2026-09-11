import type { Actor, ProjectId, UserId } from '@crewstation/contracts';

/** 本模块用到的项目内动作子集；由 project 模块的 authorize 提供。 */
export type CatalogProjectAction = 'view' | 'develop';

export interface ProjectAuthorizer {
  isAdmin(userId: UserId): Promise<boolean>;
  /** 无权限抛 forbidden，非成员抛 not_found；返回生效角色。 */
  authorize(actor: Actor, projectId: ProjectId, action: CatalogProjectAction): Promise<string>;
}
