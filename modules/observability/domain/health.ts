import type { HealthState } from '@crewstation/contracts';

export interface DeploymentObservation {
  replicas: number;
  readyReplicas: number;
  restarts: number;
  /** 最近一次容器重启距今的秒数；用于判定崩溃循环。 */
  lastRestartAgeSeconds?: number;
}

/** 健康态判定（G22）：连续重启视为崩溃循环；有副本但就绪不足为 degraded；全部不就绪为 unhealthy。 */
export function healthOf(o: DeploymentObservation): HealthState {
  if (o.replicas === 0) return 'unknown';
  if (o.restarts >= 3 && (o.lastRestartAgeSeconds ?? Infinity) < 600) return 'crash-looping';
  if (o.readyReplicas === 0) return 'unhealthy';
  if (o.readyReplicas < o.replicas) return 'degraded';
  return 'healthy';
}
