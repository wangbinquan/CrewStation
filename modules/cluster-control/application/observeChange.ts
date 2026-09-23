import type { Clock } from '@crewstation/kernel';
import { goneChild, podChild, podConditions, pvcChild, RESOURCE_ID_LABEL } from '../domain/observation';
import type { ObjectChange } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';

/** 观测的累计结果：第一期台账还空着，绝大多数是 unowned（收编第六期才认领旧对象）。 */
export interface ObservationStats {
  recorded: number;
  unchanged: number;
  unowned: number;
  /** 系统命名空间里的平台组件：不在台账范围（设计 §6.4），不查不写。 */
  platform: number;
}

export function newObservationStats(): ObservationStats {
  return { recorded: 0, unchanged: 0, unowned: 0, platform: 0 };
}

/** 一个受管对象的变化 → 子对象观测写回台账（设计 §6.2 第 3 步）。 */
export async function observeChange(ledger: LedgerObservations, clock: Clock, systemNamespace: string, stats: ObservationStats, change: ObjectChange): Promise<void> {
  const { object, gone } = change;
  if (object.metadata.namespace === systemNamespace) {
    stats.platform += 1;
    return;
  }
  const observedAt = clock.now().toISOString();
  const child = gone ? goneChild(object) : change.kind === 'Pod' ? podChild(object, observedAt) : pvcChild(object, observedAt);
  const resourceId = object.metadata.labels?.[RESOURCE_ID_LABEL];
  const conditions = !gone && change.kind === 'Pod' ? podConditions(object) : undefined;
  const outcome = await ledger.observe({ ...(resourceId ? { resourceId } : {}), child, ...(gone ? { gone } : {}), ...(conditions ? { conditions } : {}) });
  stats[outcome.status] += 1;
}
