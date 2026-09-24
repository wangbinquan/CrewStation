import type { ResourceCondition, ResourceConditionStatus, ResourceCounts, ResourceKind } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

/** 所属模块或调和器报来的一条条件；`since` 缺省由台账按「状态变了才换」自己记。 */
export interface ConditionUpdate {
  readonly type: string;
  readonly status: ResourceConditionStatus;
  readonly reason?: string;
  readonly message?: string;
  /**
   * 报告方知道的发生时刻（例如任务环境判失败的时刻）：台账接上之前就已发生的条件（补投影、收编）据此得到真实的起点，
   * 失败的保留期从这里算（D9）。晚于现在的不认；同一状态已记的起点只会往早改，不会往晚改。
   */
  readonly since?: Date;
}

function sinceOf(previous: ResourceCondition | undefined, update: ConditionUpdate, now: Date): string {
  const reported = update.since && update.since.getTime() <= now.getTime() ? update.since : undefined;
  if (!previous || previous.status !== update.status) return (reported ?? now).toISOString();
  return reported && reported.getTime() < Date.parse(previous.since) ? reported.toISOString() : previous.since;
}

/**
 * 终态条件：Job 的结果（Finished）一旦为真不再改回——观测的先后不保证，按记录核对时读到的旧版本对象（还在跑）不能把已记下的结果
 * 覆盖掉；Job 之后被 TTL 删掉，结果也就留在这里（提案 §5.1）。
 */
const TERMINAL_CONDITIONS: ReadonlySet<string> = new Set(['Finished']);

/**
 * 合并条件：同类型的状态变了才换起始时间（报告方给了发生时刻就用它），只改说明不换；新类型追加；终态条件为真之后不再改。
 * 返回原数组表示没有变化，调用方据此跳过写库（重复上报不产生变更日志）。
 */
export function mergeConditions(existing: readonly ResourceCondition[], updates: readonly ConditionUpdate[], now: Date): readonly ResourceCondition[] {
  let changed = false;
  const next = [...existing];
  for (const update of updates) {
    const at = next.findIndex((entry) => entry.type === update.type);
    const previous = at >= 0 ? next[at] : undefined;
    if (previous?.status === 'true' && TERMINAL_CONDITIONS.has(update.type)) continue;
    const since = sinceOf(previous, update, now);
    const merged: ResourceCondition = { type: update.type, status: update.status, ...(update.reason ? { reason: update.reason } : {}), ...(update.message ? { message: update.message } : {}), since };
    if (previous && jsonHash(previous) === jsonHash(merged)) continue;
    changed = true;
    if (at >= 0) next[at] = merged;
    else next.push(merged);
  }
  return changed ? next : existing;
}

/** 视图的计数：种类 × 阶段。 */
export function countByKindPhase(records: readonly { readonly kind: ResourceKind; readonly phase: string }[]): ResourceCounts {
  const counts: Record<string, Record<string, number>> = {};
  for (const record of records) {
    const byPhase = (counts[record.kind] ??= {});
    byPhase[record.phase] = (byPhase[record.phase] ?? 0) + 1;
  }
  return counts;
}

/**
 * 只由资源中心（调和器与观测）写的条件；所属模块上报这些类型会被拒绝（设计 §2.1：实况只由资源中心写）。
 * 所属模块写的是领域条件：RunnerConnected、InterfaceReady、Failed、Paused、Rebuilding、Prepared……
 */
export const CENTER_CONDITIONS: ReadonlySet<string> = new Set(['Observed', 'Applied', 'ReconcileError', 'SpecDrift', 'CrashLooping', 'Superseded', 'PendingReclaim', 'ContainersReady', 'Finished']);

export function ownerConditionViolation(updates: readonly ConditionUpdate[]): string | undefined {
  return updates.find((update) => CENTER_CONDITIONS.has(update.type))?.type;
}
