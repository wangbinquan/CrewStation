import type { Actor, ProjectId, ResourceTarget, ResourceValues, UserId } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition, validation } from '@crewstation/kernel';
import { computeAllocationRevision, taskProfileAllocationRevision } from '../api/allocationRevision';
import { INHERITED_COMPUTE_POLICY } from '../domain/projectComputePolicy';
import { allocateComputeProfile } from '../domain/resourceAllocation';
import type { AgentRuntimeUseCaseDeps } from './dependencies';

export function computeResourceAllocationUseCases(deps: AgentRuntimeUseCaseDeps, isAdmin: (id: UserId) => Promise<boolean>) {
  return {
    applyResourceChange: async (actor: Actor, projectId: ProjectId, input: { operationId: string; target: ResourceTarget; expectedRevision: string; values: ResourceValues }) => {
      if (!await isAdmin(actor.userId)) throw forbidden('算力和开发套餐分配仅平台管理员可调整');
      await deps.projects.authorize(actor, projectId, 'view'); ResourceIdSchema.parse(input.operationId);
      if (!await deps.projects.name(projectId)) throw notFound('项目');
      const settingDefault = input.target.resourceType === 'compute-profile' && input.target.action === 'set-default';
      if (!settingDefault && Object.keys(input.values).length || settingDefault && (Object.keys(input.values).some((key) => key !== 'inheritDefault') || typeof input.values.inheritDefault !== 'boolean')) throw validation('档位分配参数不适用');
      const hash = jsonHash({ projectId, input });
      return deps.uow.run(async (scope) => {
        await scope.projectPolicies.lock(projectId);
        const old = await scope.projectPolicies.receipt(projectId, input.operationId);
        if (old) { if (old.hash !== hash) throw conflict('同一资源操作标识不能修改内容'); return { revision: old.revision, effect: old.effect, applied: true }; }
        const record = await scope.projectPolicies.get(projectId), revision = record?.revision ?? 0;
        let policy = record?.policy ?? INHERITED_COMPUTE_POLICY, newRevision: string;
        if (input.target.resourceType === 'task-profile' && input.target.action === 'set-default') {
          if (!await deps.taskProfiles.exists(input.target.resourceId)) throw notFound('开发容器套餐');
          if (taskProfileAllocationRevision(revision, input.target.resourceId) !== input.expectedRevision) throw conflict('开发套餐配置已变化');
          policy = { ...policy, devTaskProfile: input.target.resourceId };
          newRevision = taskProfileAllocationRevision(revision + 1, input.target.resourceId);
        } else {
          if (input.target.resourceType !== 'compute-profile' || !['grant', 'revoke', 'set-default'].includes(input.target.action)) throw validation('不支持的算力变更');
          const profile = await scope.profiles.get(input.target.resourceId); if (!profile) throw notFound('算力档位');
          const facts = { ...profile, revision: profile.currentRevision };
          if (computeAllocationRevision(revision, facts) !== input.expectedRevision) throw conflict('算力档位或项目分配已变化');
          if (input.target.action === 'grant' && !profile.enabled) throw precondition('算力档位已停用');
          if (settingDefault) {
            if (input.values.inheritDefault) { if (policy.mode !== 'inherit') throw precondition('受限模式须先恢复平台继承范围'); policy = { ...policy, defaultOverrideProfile: null }; }
            else {
              const allowed = ((policy.mode === 'inherit' && profile.defaultVisible !== false) || policy.allowedProfiles.includes(profile.id) || policy.additionalProfiles?.includes(profile.id)) && !policy.excludedProfiles?.includes(profile.id);
              if (!allowed || !profile.enabled || profile.protocol === 'terminal') throw precondition('项目默认须为已授权、启用的 Agent 档位');
              policy = policy.mode === 'inherit' ? { ...policy, defaultOverrideProfile: profile.id } : { ...policy, defaultProfile: profile.id };
            }
          } else policy = allocateComputeProfile(policy, profile.id, input.target.action === 'grant');
          newRevision = computeAllocationRevision(revision + 1, facts);
        }
        if (!await scope.projectPolicies.save({ projectId, policy, revision: revision + 1, updatedBy: actor.userId, updatedAt: deps.clock.now() }, revision)) throw conflict('项目算力配置已变化');
        const receipt = { revision: newRevision, effect: input.target.resourceType === 'task-profile' ? '开发套餐已更新；现有工作区保持运行，下次建立工作区使用新套餐' : '算力可选范围已更新；现有执行保持原档位，新执行采用最新授权', applied: true };
        await scope.projectPolicies.saveReceipt(projectId, input.operationId, { hash, ...receipt });
        return receipt;
      });
    },
    resourceChangeReceipt: async (projectId: ProjectId, operationId: string) => { const receipt = await deps.uow.read.projectPolicies.receipt(projectId, operationId); return receipt ? { revision: receipt.revision, effect: receipt.effect, applied: receipt.applied } : undefined; },
  };
}
