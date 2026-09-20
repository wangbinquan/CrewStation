import type { Actor, ProjectComputePolicyDto, ProjectId, SaveProjectComputePolicy } from '@crewstation/contracts';
import { SaveProjectComputePolicySchema } from '@crewstation/contracts';
import { conflict, notFound, validation } from '@crewstation/kernel';
import { INHERITED_COMPUTE_POLICY } from '../domain/projectComputePolicy';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { adminOnly } from './toDto';

export function projectComputePolicyUseCases(deps: AgentRuntimeUseCaseDeps) {
  const getProjectComputePolicy = async (actor: Actor, projectId: ProjectId): Promise<ProjectComputePolicyDto> => {
    await deps.projects.authorize(actor, projectId, 'view');
    const record = await deps.uow.read.projectPolicies.get(projectId), policy = record?.policy ?? INHERITED_COMPUTE_POLICY;
    const effectiveDefaultProfile = policy.mode === 'inherit' ? (await deps.uow.read.profiles.getDefault())?.name ?? null : policy.defaultProfile;
    return { projectId, revision: record?.revision ?? 0, policy, effectiveDefaultProfile,
      effectiveDevTaskProfile: policy.devTaskProfile ?? deps.defaultTaskProfile, updatedAt: record?.updatedAt.toISOString() ?? null };
  };
  return {
    getProjectComputePolicy,
    saveProjectComputePolicy: async (actor: Actor, projectId: ProjectId, raw: SaveProjectComputePolicy): Promise<ProjectComputePolicyDto> => {
      adminOnly(actor);
      await deps.projects.authorize(actor, projectId, 'view');
      const input = SaveProjectComputePolicySchema.parse(raw), { policy } = input;
      for (const name of policy.allowedProfiles) {
        const profile = await deps.uow.read.profiles.get(name);
        if (!profile) throw validation(`算力档位 ${name} 不存在，请刷新目录`, { field: 'allowedProfiles' });
        if (name === policy.defaultProfile && profile.protocol === 'terminal') throw validation('项目默认档位必须支持业务 Agent，不能使用通用终端档位', { field: 'defaultProfile' });
      }
      if (policy.devTaskProfile && !await deps.taskProfiles.exists(policy.devTaskProfile)) throw validation(`开发容器套餐 ${policy.devTaskProfile} 不存在`, { field: 'devTaskProfile' });
      const saved = await deps.uow.run((scope) => scope.projectPolicies.save({ projectId, policy, revision: input.expectedRevision + 1, updatedBy: actor.userId, updatedAt: deps.clock.now() }, input.expectedRevision));
      if (!saved) throw conflict('项目算力授权已被修改，请重新读取后核对；本次修改未保存', { code: 'project_compute_revision_conflict' });
      return getProjectComputePolicy(actor, projectId);
    },
    projectDevTaskProfile: async (projectId: ProjectId): Promise<string | undefined> => {
      if (!await deps.projects.name(projectId)) throw notFound('项目', projectId);
      return (await deps.uow.read.projectPolicies.get(projectId))?.policy.devTaskProfile ?? undefined;
    },
  };
}
