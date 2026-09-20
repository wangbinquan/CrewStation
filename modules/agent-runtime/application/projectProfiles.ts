import type { Actor, ComputeUsage, ProjectId } from '@crewstation/contracts';
import { PlatformError, notFound, precondition } from '@crewstation/kernel';
import { INHERITED_COMPUTE_POLICY } from '../domain/projectComputePolicy';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { profileQueries } from './profileQueries';
import { resolveProfileUseCases } from './resolveProfile';

/** 项目分配同时控制可见目录和使用权限；启动使用可信任务的项目编号。 */
export function projectProfileUseCases(deps: AgentRuntimeUseCaseDeps) {
  const resolver = resolveProfileUseCases(deps), queries = profileQueries(deps);
  const policyOf = async (projectId: ProjectId) => {
    if (!await deps.projects.name(projectId)) throw notFound('项目', projectId);
    return (await deps.uow.read.projectPolicies.get(projectId))?.policy ?? INHERITED_COMPUTE_POLICY;
  };
  const authorizedName = async (projectId: ProjectId, wanted?: string): Promise<string> => {
    const policy = await policyOf(projectId);
    const name = wanted && wanted !== 'default' ? wanted : policy.mode === 'restricted' ? policy.defaultProfile : (await deps.uow.read.profiles.getDefault())?.name;
    if (!name) throw precondition('项目尚未配置可用的默认算力档位，请管理员分配', { code: 'no_project_default_profile' });
    const allowed = policy.mode === 'restricted' ? policy.allowedProfiles.includes(name) : (await deps.uow.read.profiles.get(name))?.defaultVisible !== false;
    if (!allowed) throw new PlatformError('forbidden', `项目未获授权使用算力档位 ${name}，请联系管理员分配`, { code: 'project_compute_forbidden', profile: name });
    return name;
  };
  const summaries = async (projectId: ProjectId) => {
    const policy = await policyOf(projectId);
    const profiles = await queries.listSummaries(true);
    const visible = new Set((await deps.uow.read.profiles.list()).filter((p) => p.defaultVisible !== false).map((p) => p.name));
    return profiles.filter((p) => policy.mode === 'restricted' ? policy.allowedProfiles.includes(p.name) : visible.has(p.name))
      .map((p) => ({ ...p, isDefault: policy.mode === 'restricted' ? p.name === policy.defaultProfile : p.isDefault }));
  };
  return {
    listProjectSummaries: async (actor: Actor, projectId: ProjectId) => { await deps.projects.authorize(actor, projectId, 'view'); return summaries(projectId); },
    resolveForProject: async (projectId: ProjectId, wanted: string | undefined, usage: ComputeUsage) => resolver.resolve(await authorizedName(projectId, wanted), usage),
    lookupForProjectRelease: async (projectId: ProjectId, wanted: string) => resolver.lookupForRelease(await authorizedName(projectId, wanted)),
  };
}
