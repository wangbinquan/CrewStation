import type { Actor, ProjectId, ResourceActionId } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { ViewerAccess } from '../api/types';
import type { LedgerRecord } from '../domain/record';
import type { ResourceAuthorizer } from '../ports/platform';

export interface AccessDeps {
  readonly authorizer: ResourceAuthorizer;
  /** 这个操作眼下有没有执行者；执行者在装配后才登记，每次按当时的登记判定。 */
  executable(owner: string, action: ResourceActionId): boolean;
}

/** 看的人能做什么（设计 §2.2）：项目上按开发权限；全平台只给管理员。 */
export function viewerAccess(deps: AccessDeps) {
  const projectAccess = async (actor: Actor, projectId: ProjectId): Promise<ViewerAccess> => ({ operate: (await deps.authorizer.projectAccess(actor, projectId)).operate, admin: actor.isAdmin, executable: deps.executable });
  const adminAccess = async (actor: Actor): Promise<ViewerAccess> => {
    if (!actor.isAdmin) throw forbidden('只有管理员可以查看全平台的资源');
    return { operate: true, admin: true, executable: deps.executable };
  };
  /** 一次读取里看的人对各条记录的权限：管理员一律全平台；其余按记录所在项目（每个项目只问一次），平台级的记录不给。 */
  const accessFor = (actor: Actor) => {
    const byProject = new Map<string, Promise<ViewerAccess>>();
    return (record: LedgerRecord): Promise<ViewerAccess> | undefined => {
      if (actor.isAdmin) return adminAccess(actor);
      if (!record.projectId) return undefined;
      const known = byProject.get(record.projectId) ?? projectAccess(actor, record.projectId);
      byProject.set(record.projectId, known);
      return known;
    };
  };
  return { projectAccess, adminAccess, accessFor };
}
