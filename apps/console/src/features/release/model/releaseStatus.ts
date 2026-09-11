import type { ReleaseStatus } from '@crewstation/contracts';
import type { BadgeTone } from '../../../shared/ui/Badge';

/** 发布流水线还在推进的状态：列表处于其中任一状态时要继续轮询。 */
const IN_FLIGHT: ReadonlySet<ReleaseStatus> = new Set<ReleaseStatus>(['pending', 'building', 'migrating', 'deploying']);

export function isInFlight(status: ReleaseStatus): boolean {
  return IN_FLIGHT.has(status);
}

export function releaseStatusTone(status: ReleaseStatus): BadgeTone {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'warning';
  return isInFlight(status) ? 'info' : 'neutral';
}
