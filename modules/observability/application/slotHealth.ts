import type { HealthDto, ProjectId, SlotName } from '@crewstation/contracts';
import { healthOfSlotRecord } from '@crewstation/contracts';
import { healthOf } from '../domain/health';
import type { ObservabilityUseCaseDeps } from './dependencies';

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
