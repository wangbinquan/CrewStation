import { BUILTIN_RESOURCES, DomainTopic } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { InfrastructureSourceModules, InfrastructureOriginSources, OriginalInfrastructureOrigin } from '../../ports/infrastructureOrigins';

/** Composes public owner witnesses. No module reads another module's schema or interprets missing rows as platform scope. */
export function infrastructureOriginSources(modules: InfrastructureSourceModules): InfrastructureOriginSources {
  return { resolve: async (document, reference, representation) => {
    const { kind, key } = reference;
    if ((kind === 'project' || kind === 'service') && document.channel === 'event'
      && (document.name === DomainTopic.taskCreated || document.name === DomainTopic.taskReleased)) {
      const payload = document.payload as { kind?: string; taskId?: string; projectId?: string; serviceId?: string };
      const reserved = kind === 'project' ? BUILTIN_RESOURCES.profileTestProject : BUILTIN_RESOURCES.profileTestService;
      const value = kind === 'project' ? payload.projectId : payload.serviceId;
      if (payload.kind === 'profile-test' && value === reserved && payload.taskId) {
        const id = representation === 'current' ? key : key === reserved ? key : await modules.identities.resolve(kind, [key]);
        if (id !== reserved) throw precondition('平台测试旧归属键与原保留身份不符');
        const source = await modules.taskRuntime.originalInfrastructureOwnership('task', payload.taskId);
        if (!source) return undefined;
        return { ...source, id: reserved, revision: jsonHash({ kind, id: reserved, taskId: source.id, revision: source.revision }) };
      }
    }
    switch (kind) {
      case 'project': case 'service': case 'deletion': return modules.project.originalInfrastructureOwnership(kind, key, representation);
      case 'delivery': return modules.events.originalDeliveryOwnership(key, representation);
      case 'release': return modules.release.originalInfrastructureOwnership(key, representation);
      case 'resource-change': return modules.resourceAccess.originalInfrastructureOwnership(key, representation);
      case 'api-operation': return modules.apiCatalog.originalInfrastructureOwnership(key, representation);
      case 'profile-test': return modules.agentRuntime.originalInfrastructureOwnership(key, representation);
      case 'rebuild': case 'parent-ending': return modules.taskRuntime.originalInfrastructureOwnership(kind, key, representation);
      case 'subtask': return modules.businessTask.originalInfrastructureOwnership(kind, key, representation);
      case 'cluster-refresh': case 'cluster-operation': case 'cluster-metrics': case 'cluster-storage': return modules.clusterManagement.originalInfrastructureOwnership(kind, key, representation);
      case 'task': {
        const [runtime, business] = await Promise.all([modules.taskRuntime.originalInfrastructureOwnership(kind, key, representation),
          modules.businessTask.originalInfrastructureOwnership(kind, key, representation)]);
        if (!runtime) return business;
        if (!business) return runtime;
        if (runtime.id !== business.id || runtime.scope !== business.scope || jsonHash([...runtime.projectIds].sort()) !== jsonHash([...business.projectIds].sort())) throw precondition('任务原运行环境与业务归属冲突');
        return { ...runtime, revision: jsonHash({ runtime: runtime.revision, business: business.revision }) } satisfies OriginalInfrastructureOrigin;
      }
      default: throw precondition('基础设施原来源 owner 未登记');
    }
  } };
}
