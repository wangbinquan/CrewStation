import type { AgentActivityPage, NativeTerminalDto, NativeTerminalList, ReadAgentActivityRequest } from '@crewstation/contracts';
import { AgentActivityPageSchema, NativeTerminalDtoSchema } from '@crewstation/contracts';
import { AgentActivityStore } from '../shared/activity/agentActivityStore';
import type { ActivitySource } from '../shared/activity/agentActivityStore';

export const activityProjectId = `prj_${'1'.repeat(32)}`;
export const activityTaskId = `tsk_${'2'.repeat(32)}`;
export const activityUserId = `usr_${'3'.repeat(32)}`;
export const activityTime = '2026-09-13T02:00:00.000Z';

export function activityFixture() {
  const terminal: NativeTerminalDto = NativeTerminalDtoSchema.parse({ agentId: 'agent-one', terminalId: 'terminal-one', runnerId: '00000000-0000-4000-8000-000000000001', compute: 'balanced', permission: 'edit', revision: 1, lifecycle: 'running', startedAt: activityTime, cols: 80, rows: 24, taskId: activityTaskId, createdBy: activityUserId, clientRequestId: '00000000-0000-4000-8000-000000000002', connection: 'connected' });
  const page: AgentActivityPage = AgentActivityPageSchema.parse({ taskId: activityTaskId, projectId: activityProjectId, states: [{ agentId: terminal.agentId, terminalId: terminal.terminalId, runnerId: terminal.runnerId, throughSeq: 3, source: 'ready', currentTurn: { turnId: 'turn-one', ordinal: 1, status: 'waiting', startedAt: activityTime, updatedAt: activityTime }, pending: [{ id: 'question-one', eventId: 'event-question', turnId: 'turn-one', kind: 'question', openedAt: activityTime, seq: 3, unread: true }], processEnded: false, updatedAt: activityTime }], items: [], unread: [], nextCursor: 3, throughSeq: 3, hasMore: false, historyTruncated: false, sync: 'ready', connection: 'connected', checkedAt: activityTime });
  const roster: NativeTerminalList = { items: [terminal], connection: 'connected', runnerId: terminal.runnerId, checkedAt: activityTime, activitySync: 'ready' };
  const reads: ReadAgentActivityRequest[] = [], pageCalls: Array<number | undefined> = [];
  const source: ActivitySource = {
    page: async (_task, before) => { pageCalls.push(before); return structuredClone(page); }, terminals: async () => structuredClone(roster),
    read: async (_task, input) => { reads.push(input); for (const state of page.states) for (const request of state.pending) if (state.agentId === input.agentId && request.turnId === input.turnId && request.seq <= input.throughSeq) request.unread = false; page.items = page.items.filter((item) => item.turnId !== input.turnId || item.agentId !== input.agentId || item.seq > input.throughSeq); return { throughSeq: input.throughSeq }; },
  };
  const store = new AgentActivityStore(source);
  const register = () => { store.register(activityTaskId, activityProjectId, '验收应用'); return store.refresh(activityTaskId); };
  return { terminal, page, roster, reads, source, store, register, pageCalls };
}
