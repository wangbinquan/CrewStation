import type { NativeTerminalDto } from '@crewstation/contracts';
import type { ActivityTask } from '../../../../shared/activity/agentActivityStore';
import type { ActivityStatus } from '../../../../shared/activity/agentActivityView';
import { activityStatus } from '../../../../shared/activity/agentActivityView';

/** 一个 CLI 的轮次状态：动态快照里的状态优先，名册里的兜底；断线或快照过期时是「未确认」。 */
export function nativeTerminalStatus(terminal: NativeTerminalDto | undefined, terminalId: string, activity: ActivityTask | undefined, activitySync: 'ready' | 'catching-up' | 'unavailable' | undefined, disconnected: boolean): ActivityStatus {
  const state = activity?.page?.states.find((item) => item.terminalId === terminalId) ?? terminal?.activity;
  return activityStatus(terminal, state, activity?.page ?? { sync: activitySync ?? 'unavailable', connection: terminal?.connection ?? 'unknown' }, activity?.stale || disconnected);
}

export type StatusTone = 'info' | 'warning' | 'success' | 'neutral' | 'muted';
/** 标签圆点的色调：执行中蓝、需处理或失败黄、本轮完成绿、已结束灰，其余（等待任务、未确认）空心。 */
export function statusTone(status: ActivityStatus): StatusTone {
  if (status === 'running' || status === 'starting') return 'info';
  if (status === 'waiting' || status === 'failed' || status === 'start-failed' || status === 'runtime-failed') return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'ended' || status === 'cancelled') return 'neutral';
  return 'muted';
}
