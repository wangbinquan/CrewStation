import type { Actor, ProjectId } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { EffectiveRole, ProjectAction } from '../domain/authorization';
import { isAllowed } from '../domain/authorization';
import type { ProjectUseCaseDeps } from './dependencies';

export function authorizationUseCases({ uow }: ProjectUseCaseDeps) {
  const roleOf = async (actor: Actor, projectId: ProjectId): Promise<EffectiveRole | undefined> => {
    if (actor.isAdmin) return 'admin';
    return (await uow.read.memberships.get(projectId, actor.userId))?.role;
  };
  /** 无权限时对非成员返回 404 而不是 403，避免暴露项目是否存在。 */
  const authorize = async (actor: Actor, projectId: ProjectId, action: ProjectAction): Promise<EffectiveRole> => {
    const role = await roleOf(actor, projectId);
    if (role === undefined) throw notFound('项目', projectId);
    if (!isAllowed(role, action)) throw forbidden(`角色 ${role} 不能执行 ${action}`);
    return role;
  };
  return { roleOf, authorize };
}
