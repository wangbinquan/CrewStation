import type { ResourceChild } from '@crewstation/contracts';
import type { LegacyTask } from '../domain/adoption';
import type { ObservedCondition } from '../domain/observation';

/** 台账记录里调和器用得到的部分（结构上是 resources 模块 LedgerRecord 的子集）。 */
export interface LedgerRecordView {
  readonly id: string;
  readonly kind: string;
  readonly parentId?: string;
  readonly desired: 'present' | 'absent';
  readonly phase: string;
  readonly releaseReason?: { readonly code: string; readonly message: string };
  readonly spec: { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly [field: string]: unknown };
  readonly children: readonly ResourceChild[];
  readonly conditions: readonly { readonly type: string; readonly status: string }[];
}

/** 资源中心（resources 模块）给调和器的入口，由组合根接上。 */
export interface LedgerObservations {
  get(id: string): Promise<LedgerRecordView | undefined>;
  /** 在册的记录（不含已结束的）：调和器启动与定期全量核对时逐条排进队列。 */
  listLive(): Promise<readonly LedgerRecordView[]>;
  changesSince(cursor: number, limit: number): Promise<readonly { readonly seq: number; readonly resourceId: string }[]>;
  latestChange(): Promise<number>;
  /**
   * 写一条子对象观测；unowned 表示台账里没有记录认领这个对象。owner 是控制它的上级对象（ReplicaSet 管的 Pod 所属的 Deployment）：
   * 对象本身没被认领时，认领上级的记录也认领它。
   */
  observe(input: {
    readonly resourceId?: string; readonly child: ResourceChild; readonly owner?: { readonly kind: string; readonly namespace?: string; readonly name: string };
    readonly gone?: boolean; readonly conditions?: readonly ObservedCondition[];
  }): Promise<{ readonly status: 'recorded' | 'unchanged' | 'unowned' }>;
  /** 写只归资源中心的条件（不附带子对象观测），例如工作卷的「待回收」。 */
  observeConditions(resourceId: string, conditions: readonly ObservedCondition[]): Promise<{ readonly status: 'recorded' | 'unchanged' | 'unowned' }>;
  /**
   * 孤儿 PVC（集群里有、台账里没有）：建一条归资源中心的工作卷记录认领它，并写「待回收」（设计 §6.4）；卷不删，等管理员确认。
   */
  adoptOrphanVolume(child: { readonly kind: string; readonly namespace?: string; readonly name: string; readonly uid: string }): Promise<void>;
  /** 挂在某条记录下的记录（含已结束的）：上级结束时调和器据此把工作卷排进队列。 */
  children(parentId: string): Promise<readonly LedgerRecordView[]>;
  /** 只读：认领这个集群对象的记录 ID（收编报告用，不写库）。 */
  claimOf(child: { readonly kind: string; readonly namespace?: string; readonly name: string; readonly uid?: string }): Promise<string | undefined>;
}

/** 旧形状的所属对象（收编空跑用）：按任务标签查任务环境，由组合根从身份目录与 task-runtime 取。 */
export interface LegacyOwners {
  /** RFC-013 之前的旧 ID（`tsk_…`）换成现在的 ID；身份目录里没有就返回 undefined。 */
  resolveTaskId(legacyId: string): Promise<string | undefined>;
  task(taskId: string): Promise<LegacyTask | undefined>;
}
