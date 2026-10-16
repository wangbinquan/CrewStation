import type { AgentEvent } from '@crewstation/contracts';
import type { BotConversation, BotConversationRepository, BotExecution, BotOperation } from '../../ports/botConversations';
import type { AgentStartRepository } from '../../ports/agentStarts';
import type { DevSessionUseCaseDeps } from '../dependencies';

/** Persistent event cursor: a refresh cannot replay earlier status over the current turn. */
export async function observeBot(deps: DevSessionUseCaseDeps, repo: BotConversationRepository, starts: AgentStartRepository, current: BotConversation, pending: readonly BotOperation[] = []): Promise<BotConversation> {
  if (!current.currentAgentId) return current;
  const execution = await repo.execution(current.currentAgentId);
  if (!execution || execution.epoch !== current.epoch) return current;
  let next = { ...current }, observed = { ...execution };
  const rows = await deps.runner.listEvents(execution.executionTaskId, { sinceSeq: execution.cursor, kinds: ['agent', 'beforeStart'], agentId: execution.agentId, limit: 500 });
  for (const row of rows) {
    observed.cursor = Math.max(observed.cursor, row.seq);
    if (row.event.kind === 'agent' && row.event.event.agentId === execution.agentId) ({ current: next, execution: observed } = applyEvent(next, observed, row.event.event));
  }
  const start = await starts.get(execution.agentId), env = await deps.environments.getEnvironment(execution.executionTaskId);
  if (start?.state === 'ended' && next.state !== 'unavailable' && next.state !== 'unknown') {
    if (env?.native?.state === 'finished') {
      next.state = next.nativeSessionId ? 'paused' : 'unavailable';
      next.continuity = next.nativeSessionId ? 'available' : 'unavailable';
      next.reason = next.nativeSessionId ? undefined : start.failure ?? '原生 session 尚未保存，不能无损恢复';
    } else next.state = 'stopping';
  }
  // User stop/fresh intent wins over late running/waiting events.
  if (current.state === 'stopping' && pending.some(op => op.kind !== 'message')) next.state = 'stopping';
  // The previous execution cannot reopen input while the accepted next turn is still being prepared.
  if (current.state === 'preparing' && pending.some(op => op.kind === 'message' && op.receipt.state === 'accepted') && next.continuity !== 'unavailable') next.state = 'preparing';
  observed.state = next.state;
  await repo.putExecution(observed); await repo.save(next);
  return next;
}

function applyEvent(current: BotConversation, execution: BotExecution, event: AgentEvent): { current: BotConversation; execution: BotExecution } {
  if (current.continuity === 'unavailable') return { current, execution };
  if (event.sessionId) {
    if (current.nativeSessionId && current.nativeSessionId !== event.sessionId) return { execution, current: { ...current, state: 'unavailable', continuity: 'unavailable', reason: '原生运行时返回了不同 session，本次恢复未成立' } };
    current = { ...current, nativeSessionId: event.sessionId, continuity: 'available' };
    execution = { ...execution, nativeSessionId: event.sessionId };
  }
  if (event.type === 'status' && event.status === 'waiting') current.state = 'awaiting-input';
  else if (['started', 'user-message', 'text', 'thinking', 'tool-start', 'tool-end'].includes(event.type) || event.type === 'status' && event.status === 'running') current.state = 'running';
  if (event.type === 'error' && ['bot_context_unavailable', 'bot_session_mismatch', 'session_not_found'].includes(event.error?.code ?? '')) {
    current = { ...current, state: 'unavailable', continuity: 'unavailable', reason: event.error?.message ?? '原生上下文不可用' };
  }
  return { current, execution };
}
