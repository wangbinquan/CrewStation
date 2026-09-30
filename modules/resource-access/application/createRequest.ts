import type { Actor, CreateResourceRequest, ProjectId } from '@crewstation/contracts';
import { CreateResourceRequestSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { changeDto } from '../domain/change';
import type { ResourceChange } from '../domain/change';
import { activeProject, adapterOf, requireAdmin, requestable, sameRevision, validateValues } from './access';
import type { ResourceAccessDeps } from './dependencies';

export function createResourceRequest(deps: ResourceAccessDeps, direct: boolean) {
  return async (actor: Actor, projectId: ProjectId, raw: CreateResourceRequest) => {
    const input = CreateResourceRequestSchema.parse(raw), role = await activeProject(deps, actor, projectId);
    if (direct) await requireAdmin(deps, actor);
    else if (role !== 'owner') throw forbidden('资源和配额申请仅由项目负责人提交');
    const requestHash = jsonHash({ projectId, userId: actor.userId, direct, input });
    const old = await deps.repository.byKey(projectId, actor.userId, input.requestKey);
    if (old) { if (old.requestHash !== requestHash) throw conflict('同一申请键不能用于不同内容'); return changeDto(old); }
    const view = await adapterOf(deps, input.target).read(projectId, input.target);
    if (!direct && input.target.action === 'revoke') throw forbidden('资源撤销由平台管理员直接管理');
    if (!direct && input.target.action === 'grant' && view.owned) throw precondition('项目已拥有此资源，无需重复申请');
    if (!direct && !await requestable(deps, view)) throw forbidden('该资源未明确开放申请');
    sameRevision(view, input.expectedRevision); validateValues(view, input.values);
    const now = deps.clock.now().toISOString(), name = await deps.projects.requesterName(actor.userId);
    const change: ResourceChange = {
      id: newResourceId(), projectId, target: input.target, targetName: view.name, state: direct ? 'approved' : 'pending', version: 1,
      origin: direct ? 'direct-admin' : 'owner-request', baseRevision: view.revision, baseValues: view.current,
      requestedValues: input.values, approvedValues: direct ? input.values : null, approvedRevision: direct ? view.revision : null,
      reason: input.reason, requestedBy: actor.userId, requesterName: name, decidedBy: direct ? actor.userId : null,
      deciderName: direct ? name : null, decisionReason: direct ? input.reason : null, requestKey: input.requestKey,
      createdAt: now, updatedAt: now, appliedAt: null, effect: null, failure: null, receipt: null, attempt: 0,
      requestHash,
    };
    return changeDto(await deps.repository.accept(change));
  };
}
