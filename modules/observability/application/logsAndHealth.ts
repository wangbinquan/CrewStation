import type { Actor, HealthDto, LogEntryDto, LogQuery, ProjectId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ObservabilityUseCaseDeps } from './dependencies';
import { slotHealthReader } from './slotHealth';

/** 日志页与健康态：日志直接读集群（Pod 日志尾部），不落库，采集与保留在 T2.13 的后续里补；健康照服务槽记录（RFC-025 第三期）。 */
export function logsAndHealthUseCases(deps: ObservabilityUseCaseDeps) {
  const { authorizer, services, slots, cluster } = deps;
  const slotHealth = slotHealthReader(deps);
  const svcOf = async (actor: Actor, projectId: ProjectId) => {
    await authorizer.authorize(actor, projectId, 'view');
    const svc = await services.resolveServiceOfProject(projectId);
    if (!svc) throw notFound('项目服务', projectId);
    return svc;
  };
  return {
    queryLogs: async (actor: Actor, projectId: ProjectId, query: LogQuery): Promise<LogEntryDto[]> => {
      const svc = await svcOf(actor, projectId);
      const roles = await slots.slotRoles(svc.serviceId);
      const slotSelector = query.slot ? `,crewstation.io/slot=${roles ? roles[query.slot] : 'blue'}` : ',crewstation.io/workload=service';
      const selector = query.source === 'slot'
        ? `crewstation.io/service=${svc.name}${slotSelector}`
        : query.source === 'build' || query.source === 'migration'
          ? `app.kubernetes.io/component=${query.source},crewstation.io/release=${query.releaseId ?? ''}`
          : `crewstation.io/task=${query.taskId ?? ''}`;
      const entries = await cluster.tailLogs(svc.namespace, selector, { tailLines: query.limit, ...(query.since ? { sinceSeconds: Math.max(1, Math.round((Date.now() - new Date(query.since).getTime()) / 1000)) } : {}) });
      return entries.map((e) => ({ ...e, source: query.source, ...(query.slot ? { slot: query.slot } : {}) }));
    },
    health: async (actor: Actor, projectId: ProjectId): Promise<HealthDto[]> => {
      const svc = await svcOf(actor, projectId);
      const roles = await slots.slotRoles(svc.serviceId);
      if (!roles) return [];
      return (await slotHealth({ projectId, name: svc.name, namespace: svc.namespace, roles })).map(({ slot, health }): HealthDto => (health
        ? { slot, ...health }
        : { slot, state: 'unknown', readyReplicas: 0, replicas: 0, restarts: 0, lastTransitionAt: deps.clock.now().toISOString() }));
    },
  };
}
