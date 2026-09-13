import type { AgentActivityItem, AgentActivityPage, AgentActivityState, NativeTerminalDto } from '@crewstation/contracts';
import type { ActivityTask } from './agentActivityStore';

export type ActivityStatus = 'starting' | 'start-failed' | 'running' | 'waiting' | 'completed' | 'cancelled' | 'failed' | 'ended' | 'unknown' | 'idle' | 'unconfirmed';
export interface ActivityTarget { projectId: string; taskId: string; agentId: string; terminalId: string; turnId: string | null; eventId: string; seq: number; navigationId?: string }
export interface ActivityEntry { target: ActivityTarget; kind: AgentActivityItem['kind'] | 'process-failed'; at: string; unread: boolean; uncertain: boolean; requestKind?: 'question' | 'permission'; error?: string }

export function activityTargetFromSearch(projectId: string, search: Record<string, unknown>): ActivityTarget | undefined {
  if (![search.task, search.agent, search.terminal, search.event].every((value) => typeof value === 'string' && value.length > 0) || !Number.isSafeInteger(search.seq) || Number(search.seq) < 0) return undefined;
  return { projectId, taskId: String(search.task), agentId: String(search.agent), terminalId: String(search.terminal), eventId: String(search.event), turnId: typeof search.turn === 'string' ? search.turn : null, seq: Number(search.seq), ...(typeof search.focus === 'string' ? { navigationId: search.focus } : {}) };
}

export function activityStatus(terminal: NativeTerminalDto | undefined, state?: AgentActivityState, page?: Pick<AgentActivityPage, 'connection' | 'sync'>, stale = false): ActivityStatus {
  if (terminal?.lifecycle === 'failed') return 'start-failed';
  if (terminal?.lifecycle === 'ended' || state?.processEnded) return 'ended';
  if (stale || terminal?.connection !== 'connected' || page && (page.connection !== 'connected' || page.sync !== 'ready')) return 'unknown';
  if (terminal?.lifecycle === 'starting') return 'starting';
  if (!state || state.source !== 'ready') return 'unknown';
  if (state.pending.length) return 'waiting';
  return state.currentTurn?.status ?? 'idle';
}

export function taskEntries(task: ActivityTask): ActivityEntry[] {
  const page = task.page;
  const uncertain = task.stale || page?.sync !== 'ready' || page.connection !== 'connected';
  const target = (agentId: string, terminalId: string, turnId: string | null, eventId: string, seq: number): ActivityTarget => ({ projectId: task.projectId, taskId: task.taskId, agentId, terminalId, turnId, eventId, seq });
  const pending: ActivityEntry[] = page?.states.flatMap((state) => state.processEnded ? [] : state.pending.map((request) => ({ target: target(state.agentId, state.terminalId, request.turnId, request.eventId, request.seq), kind: 'request-opened', at: request.openedAt, unread: request.unread ?? false, uncertain: uncertain || state.source !== 'ready', requestKind: request.kind }))) ?? [];
  const failures: ActivityEntry[] = task.terminals?.items.filter((terminal) => terminal.lifecycle === 'failed').map((terminal) => ({ target: target(terminal.agentId, terminal.terminalId, null, `failed:${terminal.agentId}:${terminal.revision}`, 0), kind: 'process-failed', at: terminal.endedAt ?? terminal.startedAt, unread: false, uncertain: false, error: terminal.error })) ?? [];
  const results: ActivityEntry[] = (task.older ?? page)?.items.filter((item) => item.unread && item.turnId && item.kind.startsWith('turn-') && item.kind !== 'turn-started').map((item) => ({ target: target(item.agentId, item.terminalId, item.turnId, item.eventId, item.seq), kind: item.kind, at: item.occurredAt, unread: item.unread, uncertain: task.stale })) ?? [];
  return [...pending, ...failures, ...results.reverse()];
}

export function activityCounts(task: ActivityTask | undefined, terminalIds?: readonly string[]) {
  const terminals = task?.terminals?.items.filter((terminal) => !terminalIds || terminalIds.includes(terminal.terminalId)) ?? [];
  const states = task?.page?.states.filter((state) => !terminalIds || terminalIds.includes(state.terminalId)) ?? [];
  const agentIds = new Set([...states.map((state) => state.agentId), ...terminals.map((terminal) => terminal.agentId)]);
  const unread = task?.page?.unread.filter((item) => agentIds.has(item.agentId)) ?? [];
  return {
    pending: states.filter((state) => !state.processEnded).reduce((count, state) => count + state.pending.length, 0) + terminals.filter((terminal) => terminal.lifecycle === 'failed').length + unread.reduce((count, item) => count + item.issues, 0),
    completions: unread.reduce((count, item) => count + item.completions, 0),
    running: terminals.filter((terminal) => activityStatus(terminal, states.find((state) => state.agentId === terminal.agentId), task?.page, task?.stale) === 'running').length,
  };
}
