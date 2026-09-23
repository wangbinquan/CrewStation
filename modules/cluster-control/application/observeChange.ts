import type { Clock } from '@crewstation/kernel';
import { controllerOf, deploymentChild, goneChild, jobChild, jobConditions, podChild, podConditions, presentChild, pvcChild, RESOURCE_ID_LABEL } from '../domain/observation';
import type { ObjectChange } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';

/** 观测的累计结果：第一期台账还空着，绝大多数是 unowned（收编第六期才认领旧对象）。 */
export interface ObservationStats {
  recorded: number;
  unchanged: number;
  unowned: number;
  /** 系统命名空间里的平台组件（没有任务标签的）：不在台账范围（设计 §6.4），不查不写。档位测试的 Pod 也在系统命名空间，但带任务标签，照常观测。 */
  platform: number;
  /** 调和器按 UID 删掉的子对象（所属记录已「不要了」）。 */
  removed: number;
  /** 上级已结束、写上「待回收」的工作卷。 */
  reclaimable: number;
}

export function newObservationStats(): ObservationStats {
  return { recorded: 0, unchanged: 0, unowned: 0, platform: 0, removed: 0, reclaimable: 0 };
}

function childOf(kind: ObjectChange['kind'], object: ObjectChange['object'], observedAt: string) {
  if (kind === 'Pod') return podChild(object, observedAt);
  if (kind === 'PersistentVolumeClaim') return pvcChild(object, observedAt);
  if (kind === 'Job') return jobChild(object, observedAt);
  return kind === 'Deployment' ? deploymentChild(object, observedAt) : presentChild(object, observedAt);
}

/** 观测附带的只归资源中心的条件：裸 Pod 的崩溃重启、Job 的结束。 */
function conditionsOf(change: ObjectChange, controlled: boolean) {
  if (change.gone) return undefined;
  if (change.kind === 'Job') return jobConditions(change.object);
  return change.kind === 'Pod' && !controlled ? podConditions(change.object) : undefined;
}

/**
 * 一个受管对象的变化 → 子对象观测写回台账（设计 §6.2 第 3 步）。Deployment、Job 管的 Pod（服务槽的副本、构建与迁移的 Pod）带上它的控制者：
 * 认领控制者的记录也认领它；服务槽副本的崩溃重启不按单个 Pod 写，由调和器汇总这个 Deployment 名下所有 Pod 后写（G22）。
 */
export async function observeChange(ledger: LedgerObservations, clock: Clock, systemNamespace: string, stats: ObservationStats, change: ObjectChange): Promise<void> {
  const { object, gone } = change;
  if (object.metadata.namespace === systemNamespace && !object.metadata.labels?.['crewstation.io/task']) {
    stats.platform += 1;
    return;
  }
  const observedAt = clock.now().toISOString();
  const child = gone ? goneChild(object) : childOf(change.kind, object, observedAt);
  const resourceId = object.metadata.labels?.[RESOURCE_ID_LABEL];
  const owner = change.kind === 'Pod' ? controllerOf(object) : undefined;
  const conditions = conditionsOf(change, owner !== undefined);
  const outcome = await ledger.observe({ ...(resourceId ? { resourceId } : {}), child, ...(owner ? { owner } : {}), ...(gone ? { gone } : {}), ...(conditions ? { conditions } : {}) });
  stats[outcome.status] += 1;
}
