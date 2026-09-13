import type { AgentActivityItem, AgentActivityState, AgentPendingRequest, AgentTurnSummary, NativeActivityEvent, NativeTerminalRecord } from '@crewstation/contracts';

export interface NativeActivityProjection {
  state: AgentActivityState;
  sourceSeq: number;
  turns: AgentTurnSummary[];
}

export function initialNativeActivity(record: NativeTerminalRecord): NativeActivityProjection {
  return {
    sourceSeq: 0, turns: [],
    // 名册可能已经保存退出，仍须按持久事件顺序补完退出前的结果。
    state: { agentId: record.agentId, terminalId: record.terminalId, runnerId: record.runnerId, throughSeq: 0, source: 'unknown', currentTurn: null, pending: [], processEnded: false, updatedAt: record.startedAt },
  };
}

function unavailable(projection: NativeActivityProjection, reason: AgentActivityState['sourceReason']): void {
  if (projection.state.source === 'unavailable') return;
  projection.state.source = 'unavailable'; projection.state.sourceReason = reason;
}

/** 返回新对象；源缺口永久降低本进程可信度，旧轮次可记历史但不能覆盖当前执行状态。 */
export function projectNativeActivity(previous: NativeActivityProjection, input: NativeActivityEvent, seq: number): { projection: NativeActivityProjection; item?: AgentActivityItem } {
  const identity = previous.state;
  if (input.agentId !== identity.agentId || input.terminalId !== identity.terminalId || input.runnerId !== identity.runnerId || input.seq <= previous.sourceSeq || seq <= identity.throughSeq) return { projection: previous };
  const projection = structuredClone(previous);
  const { state } = projection, { signal } = input;
  let accepted = true;
  if (input.seq !== projection.sourceSeq + 1) unavailable(projection, 'channel-gap');
  projection.sourceSeq = input.seq; state.throughSeq = seq; state.updatedAt = signal.occurredAt;
  if (signal.kind === 'process-ended') { accepted = !state.processEnded; state.processEnded = true; state.pending = []; }
  else if (state.processEnded) return { projection };
  else if (signal.kind === 'source-unavailable') unavailable(projection, signal.reason ?? 'source-error');
  else if (signal.kind === 'source-ready' && state.source !== 'unavailable') state.source = 'ready';
  else if (state.source === 'ready') accepted = applyTurn(projection, input, seq);
  else if (signal.kind.startsWith('turn-') || signal.kind.startsWith('request-')) unavailable(projection, 'unmatched-event');
  const active = projection.turns.reduce<AgentTurnSummary | null>((last, turn) => !last || turn.ordinal > last.ordinal ? turn : last, null);
  state.currentTurn = active ? { ...active } : null;
  if (!accepted || (state.source !== 'ready' && signal.kind !== 'source-unavailable' && signal.kind !== 'process-ended')) return { projection };
  const item: AgentActivityItem = {
    eventId: input.eventId, agentId: input.agentId, terminalId: input.terminalId, runnerId: input.runnerId, seq,
    turnId: signal.turnId, kind: signal.kind, occurredAt: signal.occurredAt, unread: false,
    ...(signal.request ? { request: { ...signal.request, ...(signal.kind === 'request-resolved' ? { resolvedByEventId: input.eventId } : {}) } } : {}),
  };
  return { projection, item };
}

function applyTurn(projection: NativeActivityProjection, input: NativeActivityEvent, seq: number): boolean {
  const { signal } = input;
  if (!signal.turnId || input.turnOrdinal < 1) { unavailable(projection, 'unmatched-event'); return false; }
  let turn = projection.turns.find((item) => item.turnId === signal.turnId);
  if (signal.kind === 'turn-started') {
    if (turn) return false;
    if (projection.turns.some((item) => item.ordinal === input.turnOrdinal)) { unavailable(projection, 'unmatched-event'); return false; }
    if (projection.turns.length >= 128) {
      const old = projection.turns.findIndex((item) => !['running', 'waiting'].includes(item.status));
      if (old < 0) { unavailable(projection, 'capacity'); return false; }
      projection.turns.splice(old, 1);
    }
    turn = { turnId: signal.turnId, ordinal: input.turnOrdinal, status: 'running', startedAt: signal.occurredAt, updatedAt: signal.occurredAt };
    projection.turns.push(turn);
    return true;
  }
  if (!turn || turn.ordinal !== input.turnOrdinal) { unavailable(projection, 'unmatched-event'); return false; }
  if (signal.kind.startsWith('request-')) {
    if (!applyRequest(projection, turn, input, seq)) return false;
  }
  else {
    const outcomes: Partial<Record<typeof signal.kind, AgentTurnSummary['status']>> = { 'turn-completed': 'completed', 'turn-cancelled': 'cancelled', 'turn-failed': 'failed', 'turn-unconfirmed': 'unconfirmed' };
    const outcome = outcomes[signal.kind];
    if (!outcome) { unavailable(projection, 'unmatched-event'); return false; }
    // 未确认可以被同轮后到的确定证据补齐；确定结果不被迟到的 unknown 冲掉。
    if (turn.status === outcome || (['completed', 'cancelled', 'failed'].includes(turn.status) && outcome === 'unconfirmed')) return false;
    if (['completed', 'cancelled', 'failed'].includes(turn.status)) { unavailable(projection, 'unmatched-event'); return false; }
    turn.status = outcome;
    projection.state.pending = projection.state.pending.filter((item) => item.turnId !== turn.turnId);
  }
  turn.updatedAt = signal.occurredAt;
  return true;
}

function applyRequest(projection: NativeActivityProjection, turn: AgentTurnSummary, input: NativeActivityEvent, seq: number): boolean {
  const request = input.signal.request;
  if (!request) { unavailable(projection, 'unmatched-event'); return false; }
  const pending = projection.state.pending;
  const matches = (item: AgentPendingRequest) => item.turnId === turn.turnId && item.id === request.id;
  const existing = pending.find(matches);
  if (existing && existing.kind !== request.kind) { unavailable(projection, 'unmatched-event'); return false; }
  if (input.signal.kind === 'request-opened') {
    if (!['running', 'waiting'].includes(turn.status) || existing) return false;
    if (pending.length >= 128) { unavailable(projection, 'capacity'); return false; }
    pending.push({ id: request.id, eventId: input.eventId, kind: request.kind, turnId: turn.turnId, openedAt: input.signal.occurredAt, seq });
    turn.status = 'waiting';
  } else {
    if (!existing) return false;
    projection.state.pending = pending.filter((item) => !matches(item));
    if (turn.status === 'waiting' && !projection.state.pending.some((item) => item.turnId === turn.turnId)) turn.status = 'running';
  }
  return true;
}

export function activityNotifies(kind: AgentActivityItem['kind']): boolean {
  return ['request-opened', 'turn-completed', 'turn-cancelled', 'turn-failed', 'turn-unconfirmed'].includes(kind);
}

export function projectNativeLifecycle(previous: NativeActivityProjection, record: NativeTerminalRecord, seq: number, at: string): { projection: NativeActivityProjection; item?: AgentActivityItem } {
  if (record.agentId !== previous.state.agentId || record.terminalId !== previous.state.terminalId || record.runnerId !== previous.state.runnerId || seq <= previous.state.throughSeq) return { projection: previous };
  const projection = structuredClone(previous);
  projection.state.throughSeq = seq; projection.state.updatedAt = at;
  if (!['ended', 'failed'].includes(record.lifecycle) || projection.state.processEnded) return { projection };
  projection.state.processEnded = true; projection.state.pending = [];
  return { projection, item: {
    eventId: `terminal:${record.agentId}:${record.runnerId}:${record.revision}`, agentId: record.agentId, terminalId: record.terminalId, runnerId: record.runnerId,
    seq, turnId: null, kind: 'process-ended', occurredAt: at, unread: false,
  } };
}
