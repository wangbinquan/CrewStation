import type { AlertType, HealthState } from '@crewstation/contracts';

export interface AlertCandidate { type: AlertType; key: string; detail: string }

/** 从健康态与业务事实推导告警候选；同 key 已触发则不重复。 */
export function alertsFromHealth(slot: string, state: HealthState): AlertCandidate[] {
  if (state === 'crash-looping') return [{ type: 'crash-loop', key: `crash-loop:${slot}`, detail: `${slot} 槽容器反复重启` }];
  if (state === 'unhealthy' || state === 'degraded') return [{ type: 'health-failing', key: `health-failing:${slot}`, detail: `${slot} 槽健康检查未通过（${state}）` }];
  return [];
}

export function resolvedKeysForHealthy(slot: string): string[] {
  return [`crash-loop:${slot}`, `health-failing:${slot}`];
}
