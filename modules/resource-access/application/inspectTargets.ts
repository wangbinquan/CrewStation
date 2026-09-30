import type { Actor, ProjectId, ResourceActionDescriptor, ResourceTarget, ResourceTargetInspection } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ResourceAccessDeps } from './dependencies';
import { adapterOf, requireAdmin, requestable } from './access';
import type { ResourceTargetView } from '../ports/resources';

async function describe(deps: ResourceAccessDeps, role: string, active: boolean, view: ResourceTargetView): Promise<ResourceTargetInspection | undefined> {
  const admin = role === 'admin', canRequest = await requestable(deps, view);
  if (!admin && !view.owned && !canRequest) return undefined;
  const actions: ResourceActionDescriptor[] = [], base = { target: view.target, revision: view.revision, current: view.current, fields: view.fields, impact: view.impact, enabled: active && view.available, reason: !active ? '项目已归档' : view.reason };
  const actionId = `${view.target.resourceType}:${view.target.resourceId}:${view.target.action}`;
  if (role === 'owner' && canRequest && view.target.action !== 'revoke' && !(view.target.action === 'grant' && view.owned)) actions.push({ ...base, id: `request:${actionId}`, kind: 'request', label: view.actionLabel ? `申请${view.actionLabel}` : view.target.action === 'grant' ? '申请资源' : '申请调整' });
  if (admin) {
    if (!(view.target.action === 'grant' && view.owned)) actions.push({ ...base, id: `direct:${actionId}`, kind: 'direct', label: view.actionLabel ?? (view.target.action === 'grant' ? '直接分配' : view.target.action === 'revoke' ? '撤销分配' : '直接调整') });
  }
  const policy = admin && view.target.action === 'grant' ? await deps.repository.policy(view.target.resourceType, view.target.resourceId) : null;
  return { view, actions, policy, requestable: canRequest };
}

export function resourceInspectionUseCases(deps: ResourceAccessDeps) {
  return {
    inspect: async (actor: Actor, projectId: ProjectId, target: ResourceTarget) => {
      const role = await deps.projects.authorize(actor, projectId, 'view');
      const result = await describe(deps, role, await deps.projects.active(projectId), await adapterOf(deps, target).read(projectId, target));
      if (!result) throw notFound('可申请资源');
      return result;
    },
    targets: async (actor: Actor, projectId: ProjectId, type: ResourceTarget['resourceType']) => {
      const role = await deps.projects.authorize(actor, projectId, 'view'), active = await deps.projects.active(projectId);
      if (role === 'admin') await requireAdmin(deps, actor);
      const adapter = adapterOf(deps, { resourceType: type, resourceId: 'catalog', action: 'grant' });
      const views = await adapter.list(projectId);
      const results = await Promise.all(views.map((view) => describe(deps, role, active, view)));
      return results.filter((v): v is ResourceTargetInspection => v !== undefined);
    },
  };
}
