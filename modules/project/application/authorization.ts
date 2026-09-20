import type { Actor, ProjectId } from '@crewstation/contracts';
import { forbidden, notFound } from '@crewstation/kernel';
import type { EffectiveRole, ProjectAction } from '../domain/authorization';
import { currentActor } from './creation/eligibility';
import { isAllowed } from '../domain/authorization';
import type { ProjectUseCaseDeps } from './dependencies';

export function authorizationUseCases(deps: ProjectUseCaseDeps) {
  const { uow } = deps;
  const roleOf = async (actor: Actor, projectId: ProjectId): Promise<EffectiveRole | undefined> => {
    const fresh = await currentActor(deps, actor);
    if (fresh.isAdmin) return 'admin';
    const membership = await uow.read.memberships.get(projectId, actor.userId);
    if (!membership) return undefined;
    return fresh.platformRole === 'user' ? 'tester' : membership.role;
  };
  /** 无权限时对非成员返回 404 而不是 403，避免暴露项目是否存在。 */
  const authorize = async (actor: Actor, projectId: ProjectId, action: ProjectAction): Promise<EffectiveRole> => {
    const role = await roleOf(actor, projectId);
    if (role === undefined) throw notFound('项目', projectId);
    if (role !== 'admin' && action !== 'view-preview' && (await uow.read.projects.getById(projectId))?.kind !== 'DigitalWorker') throw forbidden('接入容器仅管理员可管理');
    if (!isAllowed(role, action)) throw forbidden(`角色 ${role} 不能执行 ${action}`);
    return role;
  };
  return { roleOf, authorize };
}
