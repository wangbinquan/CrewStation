import type { Actor, DecideResourceRequest, ProjectId } from '@crewstation/contracts';
import { DecideResourceRequestSchema } from '@crewstation/contracts';
import { conflict, forbidden, precondition } from '@crewstation/kernel';
import { changeDto, sameValues } from '../domain/change';
import type { ResourceAccessDeps } from './dependencies';
import { activeProject, adapterOf, loadChange, requireAdmin, requestable, sameRevision, validateValues } from './access';

export function resourceReviewUseCases(deps: ResourceAccessDeps) {
  return {
    decide: async (actor: Actor, projectId: ProjectId, id: string, raw: DecideResourceRequest) => {
      await requireAdmin(deps, actor); await activeProject(deps, actor, projectId);
      const input = DecideResourceRequestSchema.parse(raw), change = await loadChange(deps, actor, projectId, id);
      if (change.version !== input.expectedVersion) throw conflict('申请已被处理，请重新读取');
      if (!['pending', 'needs-review'].includes(change.state) || change.receipt) throw precondition('当前申请状态不能审批');
      let revision = change.baseRevision, values = change.requestedValues;
      if (input.approve) {
        const view = await adapterOf(deps, change.target).read(projectId, change.target);
        sameRevision(view, input.expectedRevision); values = input.values ?? change.requestedValues; validateValues(view, values);
        if (change.origin === 'owner-request') {
          const role = await deps.projects.authorize({ userId: change.requestedBy, isAdmin: false }, projectId, 'request-resources');
          if (role !== 'owner') throw forbidden('申请人已不是项目负责人，请撤回并重新发起');
          if (!await requestable(deps, view)) throw precondition('目录已撤回申请资格，请拒绝原申请');
        }
        if (!sameValues(values, change.requestedValues) && input.reason.trim().length < 5) throw precondition('修改批准值时需填写调整理由（至少 5 个字符）');
        revision = view.revision;
      }
      const next = { ...change, version: change.version + 1, state: input.approve ? 'approved' as const : 'rejected' as const,
        decidedBy: actor.userId, deciderName: await deps.projects.requesterName(actor.userId), decisionReason: input.reason,
        approvedValues: input.approve ? values : null, approvedRevision: input.approve ? revision : null,
        failure: null, updatedAt: deps.clock.now().toISOString() };
      if (!await deps.repository.save(next, change.version, input.approve)) throw conflict('申请已被其他管理员处理');
      return changeDto(next);
    },
    cancel: async (actor: Actor, projectId: ProjectId, id: string, expectedVersion: number) => {
      const role = await activeProject(deps, actor, projectId), change = await loadChange(deps, actor, projectId, id);
      if (role !== 'admin' && (role !== 'owner' || change.requestedBy !== actor.userId)) throw forbidden('仅当前负责人可撤回自己的申请');
      if (role === 'admin') await requireAdmin(deps, actor);
      if (change.version !== expectedVersion) throw conflict('申请已变化');
      if (!['pending', 'needs-review'].includes(change.state) || change.receipt) throw precondition('申请已进入应用阶段，不能撤回');
      const next = { ...change, state: 'cancelled' as const, version: change.version + 1, updatedAt: deps.clock.now().toISOString(), decidedBy: actor.userId, deciderName: await deps.projects.requesterName(actor.userId), decisionReason: '撤回申请' };
      if (!await deps.repository.save(next, expectedVersion)) throw conflict('申请已被处理');
      return changeDto(next);
    },
    retry: async (actor: Actor, projectId: ProjectId, id: string, expectedVersion: number) => {
      await requireAdmin(deps, actor); await activeProject(deps, actor, projectId);
      const change = await loadChange(deps, actor, projectId, id);
      if (change.version !== expectedVersion) throw conflict('申请已变化');
      if (change.state !== 'apply-failed' && change.state !== 'applying') throw precondition('该状态无需重试');
      const next = { ...change, state: change.receipt ? 'applying' as const : 'approved' as const, version: change.version + 1, failure: null, updatedAt: deps.clock.now().toISOString() };
      if (!await deps.repository.save(next, expectedVersion, true)) throw conflict('申请已被处理');
      return changeDto(next);
    },
  };
}
