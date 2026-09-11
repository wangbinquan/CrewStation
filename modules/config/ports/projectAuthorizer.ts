import type { Actor, ProjectId } from '@crewstation/contracts';
import type { ConfigWriteAction } from '../domain/configItem';

export type ConfigProjectAction = 'view' | ConfigWriteAction;

/** 由 project 模块提供：按 Design §7.3 角色表判定；无权限抛 forbidden，非成员抛 not_found，返回生效角色。 */
export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: ConfigProjectAction): Promise<string>;
}
