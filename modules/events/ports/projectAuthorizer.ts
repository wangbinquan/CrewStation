import type { Actor, ProjectId, UserId } from '@crewstation/contracts';

/** 本模块用到的项目内动作子集；重放死信是影响生产行为的负责人操作，暂借 manage-production-config 表达。 */
export type EventsProjectAction = 'view' | 'manage-production-config';

export interface ProjectAuthorizer {
  isAdmin(userId: UserId): Promise<boolean>;
  /** 无权限抛 forbidden，非成员抛 not_found；返回生效角色。 */
  authorize(actor: Actor, projectId: ProjectId, action: EventsProjectAction): Promise<string>;
}
