import type { AgentInstanceState, DevSessionState, PreviewState, TaskDataBindingState } from '@crewstation/contracts';
import type { BadgeTone } from '../../../shared/ui/Badge';
import type { StreamStatus } from './taskStreamSocket';

/** 状态到色调的唯一映射：各面板不各写一份 if。 */
export function sessionStateTone(state: DevSessionState): BadgeTone {
  if (state === 'running') return 'success';
  if (state === 'failed') return 'warning';
  return state === 'creating' || state === 'releasing' ? 'info' : 'neutral';
}

export function streamStatusTone(status: StreamStatus): BadgeTone {
  if (status === 'open') return 'success';
  if (status === 'closed') return 'neutral';
  return status === 'reconnecting' ? 'warning' : 'info';
}

export function agentStateTone(state: AgentInstanceState): BadgeTone {
  if (state === 'running' || state === 'starting') return 'info';
  if (state === 'awaiting-input') return 'warning';
  if (state === 'failed') return 'warning';
  return state === 'completed' ? 'success' : 'neutral';
}

export function previewStateTone(state: PreviewState): BadgeTone {
  if (state === 'ready') return 'success';
  if (state === 'crashed') return 'warning';
  return state === 'starting' ? 'info' : 'neutral';
}

export function bindingStateTone(state: TaskDataBindingState): BadgeTone {
  if (state === 'active' || state === 'approved') return 'success';
  if (state === 'requested') return 'info';
  return state === 'rejected' ? 'warning' : 'neutral';
}

/** Agent 是否还能收消息：结束态的输入框禁用。 */
export function agentAcceptsInput(state: AgentInstanceState): boolean {
  return state === 'running' || state === 'starting' || state === 'awaiting-input';
}
