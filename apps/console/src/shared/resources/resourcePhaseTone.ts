// RFC-025 八个标准阶段在徽标上的色调：各页面共用这一份，不各自按阶段挑颜色。
import type { ResourcePhase } from '@crewstation/contracts';
import type { BadgeTone } from '../ui/Badge';

const TONE: Readonly<Record<ResourcePhase, BadgeTone>> = {
  pending: 'info', provisioning: 'info', starting: 'info', ready: 'success', degraded: 'warning', stopping: 'neutral', stopped: 'neutral', failed: 'danger',
};

export function resourcePhaseTone(phase: ResourcePhase): BadgeTone {
  return TONE[phase];
}
