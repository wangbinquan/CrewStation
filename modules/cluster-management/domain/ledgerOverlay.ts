import type { ClusterLedger, ClusterResource } from '@crewstation/contracts';

/** 调和器按期望维护的对象（路由、限流中间件、命名空间与额度、网络策略）：删了会被补回（I29 裁定 (2)）。 */
export const MAINTAINED_REASON = '由资源中心按期望维护，删除后会被补回；要移除请从所属功能下线或释放';
/** 工作卷由资源中心管：直接删 PVC 绕过了「待回收」的确认（设计 §6.4、D8）。 */
export const VOLUME_REASON = '工作卷由资源中心管理：待回收的请在「待回收的工作卷」里删除';

/** 集群对象在台账里的键：种类＋命名空间＋名字（命名空间级对象的命名空间为空）。 */
export const claimKey = (object: { readonly kind: string; readonly namespace?: string; readonly name: string }): string => `${object.kind}/${object.namespace ?? ''}/${object.name}`;

/**
 * 清单一行叠加所属标准记录（RFC-025 T13，I29 裁定 (1)）：阶段、原因与可做操作照记录给；台账维护的对象与工作卷的「删除」禁用并写明去处。
 * 只读视图（项目成员的盘点）不给任何操作，叠加里的也清空。
 */
export function withLedger(row: ClusterResource, ledger: ClusterLedger | undefined, readOnly = false): ClusterResource {
  if (!ledger) return row;
  const reason = ledger.maintained ? MAINTAINED_REASON : ledger.kind === 'volume' ? VOLUME_REASON : undefined;
  const availableActions = reason ? row.availableActions.map((action) => (action.action === 'delete' ? { ...action, enabled: false, reason, executionRoute: 'none' as const, impactSummary: [] } : action)) : row.availableActions;
  return { ...row, availableActions, ledger: readOnly ? { ...ledger, actions: [] } : ledger };
}
