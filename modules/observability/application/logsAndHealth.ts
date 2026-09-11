import type { Actor, HealthDto, LogEntryDto, LogQuery, ProjectId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { healthOf } from '../domain/health';
import type { ObservabilityUseCaseDeps } from './dependencies';

/** 日志页与健康态：首版直接读集群（Pod 日志尾部与 Deployment 状态），不落库；采集与保留在 T2.13 的后续里补。 */
export function logsAndHealthUseCases(deps: ObservabilityUseCaseDeps) {
  const { authorizer, services, slots, cluster } = deps;
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
      const selector = query.source === 'slot'
        ? `crewstation.io/service=${svc.name},crewstation.io/slot=${roles ? roles[query.slot ?? 'prod'] : 'blue'}`
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
      const out: HealthDto[] = [];
      for (const role of ['prod', 'preview'] as const) {
        const o = await cluster.observeDeployment(svc.namespace, `${svc.name}-${roles[role]}`);
        out.push(o
          ? { slot: role, state: healthOf(o), readyReplicas: o.readyReplicas, replicas: o.replicas, restarts: o.restarts, lastTransitionAt: o.lastTransitionAt }
          : { slot: role, state: 'unknown', readyReplicas: 0, replicas: 0, restarts: 0, lastTransitionAt: deps.clock.now().toISOString() });
      }
      return out;
    },
  };
}
