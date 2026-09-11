import type { Actor, ProjectId } from '@crewstation/contracts';

/** 本模块用到的项目内动作子集；名字与 project 模块的 ProjectAction 一致，由 wiring 直接转接。 */
export type ScmProjectAction = 'view' | 'develop' | 'publish';

/** 由 project 模块提供：无权限抛 forbidden，非成员抛 not_found。 */
export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: ScmProjectAction): Promise<unknown>;
}
