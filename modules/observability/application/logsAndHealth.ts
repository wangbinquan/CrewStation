import { type Actor, type HealthDto, type LogEntryDto, type LogQuery, type ProjectId, type SlotName, healthOfSlotRecord } from "@crewstation/contracts";
import { notFound } from "@crewstation/kernel";
import type { ObservabilityUseCaseDeps } from "./dependencies";
import { healthOf } from "../domain/health";

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

/** 一个槽的健康（HealthDto 去掉槽名）；Deployment 不在时没有。 */
export type SlotHealth = Omit<HealthDto, 'slot'>;

export interface SlotHealthTarget {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly namespace: string;
  readonly roles: Readonly<Record<SlotName, 'blue' | 'green'>>;
}

/**
 * 两个槽的健康（RFC-025 第三期）：照服务槽记录推导——资源中心观测 Deployment 与它的 Pod、汇总崩溃重启（§11.2 反向，判定同 G22）；
 * 台账读失败或还没有这个槽的记录时，退回按请求读 Deployment 与 Pod。线上在前。
 */
export function slotHealthReader(deps: Pick<ObservabilityUseCaseDeps, 'cluster' | 'records' | 'logger'>) {
  return async (target: SlotHealthTarget): Promise<Array<{ readonly slot: SlotName; readonly health: SlotHealth | undefined }>> => {
    const records = await deps.records?.slotRecords(target.projectId).catch((error: unknown) => {
      deps.logger.warn('slot records unavailable, reading the cluster', { projectId: target.projectId, error: String(error) });
      return undefined;
    });
    const out: Array<{ readonly slot: SlotName; readonly health: SlotHealth | undefined }> = [];
    for (const slot of ['prod', 'preview'] as const) {
      const record = records?.find((entry) => entry.physical === target.roles[slot]);
      if (record) {
        out.push({ slot, health: healthOfSlotRecord(record) });
        continue;
      }
      const o = await deps.cluster.observeDeployment(target.namespace, `${target.name}-${target.roles[slot]}`);
      out.push({ slot, health: o ? { state: healthOf(o), readyReplicas: o.readyReplicas, replicas: o.replicas, restarts: o.restarts, lastTransitionAt: o.lastTransitionAt } : undefined });
    }
    return out;
  };
}
