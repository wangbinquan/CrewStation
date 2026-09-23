import type { ResourceChild } from '@crewstation/contracts';
import type { LegacyTask } from '../domain/adoption';
import type { ObservedCondition } from '../domain/observation';

/** 资源中心（resources 模块）给调和器的入口，由组合根接上。 */
export interface LedgerObservations {
  /** 写一条子对象观测；unowned 表示台账里没有记录认领这个对象。 */
  observe(input: { readonly resourceId?: string; readonly child: ResourceChild; readonly gone?: boolean; readonly conditions?: readonly ObservedCondition[] }): Promise<{ readonly status: 'recorded' | 'unchanged' | 'unowned' }>;
  /** 只读：认领这个集群对象的记录 ID（收编报告用，不写库）。 */
  claimOf(child: { readonly kind: string; readonly namespace?: string; readonly name: string; readonly uid?: string }): Promise<string | undefined>;
}

/** 旧形状的所属对象（收编空跑用）：按任务标签查任务环境，由组合根从身份目录与 task-runtime 取。 */
export interface LegacyOwners {
  /** RFC-013 之前的旧 ID（`tsk_…`）换成现在的 ID；身份目录里没有就返回 undefined。 */
  resolveTaskId(legacyId: string): Promise<string | undefined>;
  task(taskId: string): Promise<LegacyTask | undefined>;
}
