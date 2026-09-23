import type { AlertType, HealthState, SlotName } from '@crewstation/contracts';

export interface AlertCandidate { type: AlertType; key: string; detail: string }

/** 只解码本模块写入的健康规则 key；不能从自由文本 detail 猜测日志目标。 */
export function slotOfAlert(type: AlertType, key: string): SlotName | undefined {
  return (['prod', 'preview'] as const).find((slot) => key === `${type}:${slot}`);
}

/** 从健康态推导告警候选；同 key 已触发则不重复。 */
export function alertsFromHealth(slot: string, state: HealthState): AlertCandidate[] {
  if (state === 'crash-looping') return [{ type: 'crash-loop', key: `crash-loop:${slot}`, detail: `${slot} 槽容器反复重启` }];
  if (state === 'unhealthy' || state === 'degraded') return [{ type: 'health-failing', key: `health-failing:${slot}`, detail: `${slot} 槽健康检查未通过（${state}）` }];
  return [];
}

export function resolvedKeysForHealthy(slot: string): string[] {
  return [`crash-loop:${slot}`, `health-failing:${slot}`];
}
