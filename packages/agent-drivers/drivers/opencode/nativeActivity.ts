import type { NativeActivitySignal, OpencodeActivityInput } from '@crewstation/contracts';

interface Turn {
  id: string;
  sessionId: string;
  messageId: string;
  settled: boolean;
  uncertain: boolean;
  requests: Map<string, 'question' | 'permission'>;
  assistant?: Extract<OpencodeActivityInput, { type: 'assistant' }>;
}

const MAX_TURNS = 128;
const MAX_SESSIONS = 128;
const MAX_REQUESTS = 64;

/** 固定版本的官方插件事件。工具消息完成只是候选，必须等该会话 idle 后确认整轮。 */
export class OpencodeNativeActivity {
  private readonly sessions = new Map<string, { root: boolean; idle: boolean; currentTurn?: string; lastPromptAt?: string; lastPromptId?: string }>();
  private readonly turns = new Map<string, Turn>();
  private readonly messages = new Map<string, string>();
  private readonly seen = new Set<string>();
  private healthy = true;
  constructor(private readonly emit: (signal: NativeActivitySignal) => void) {}

  accept(input: OpencodeActivityInput): void {
    if (this.seen.has(input.eventId)) return;
    this.seen.add(input.eventId);
    if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
    if (input.type === 'session') { this.registerSession(input); return; }
    const session = this.sessions.get(input.sessionId);
    // 未确认父子关系的会话不能冒充用户的主会话。
    if (!session?.root || !this.healthy) return;
    if (input.type === 'prompt') { this.start(input); return; }
    if (input.type === 'status') {
      session.idle = input.status === 'idle';
      for (const turn of this.turns.values()) {
        if (turn.sessionId !== input.sessionId || turn.settled) continue;
        if (session.idle) this.finish(turn, input);
        else if (turn.uncertain && session.currentTurn === turn.id) { turn.uncertain = false; this.publish(turn, input, 'turn-started'); }
      }
      return;
    }
    if (input.type === 'assistant') { this.assistant(input); return; }
    if (input.type === 'request') { this.request(input); return; }
    this.resolve(input);
  }

  gap(at: string, eventId: string, reason: NativeActivitySignal['reason'] = 'channel-gap'): void {
    if (!this.healthy) return;
    this.healthy = false;
    this.emit({ source: 'opencode/1.18.29', sourceEventId: eventId, occurredAt: at, nativeSessionId: null, turnId: null, kind: 'source-unavailable', reason });
  }

  private registerSession(input: Extract<OpencodeActivityInput, { type: 'session' }>): void {
    if (!this.sessions.has(input.sessionId) && this.sessions.size >= MAX_SESSIONS) { this.gap(input.at, input.eventId, 'capacity'); return; }
    this.sessions.set(input.sessionId, { idle: false, ...this.sessions.get(input.sessionId), root: input.parentId === null });
  }

  private start(input: Extract<OpencodeActivityInput, { type: 'prompt' }>): void {
    const id = `${input.sessionId}:${input.messageId}`;
    if (this.turns.has(id)) return;
    const session = this.sessions.get(input.sessionId)!;
    if (session.lastPromptAt && (input.at < session.lastPromptAt || (input.at === session.lastPromptAt && input.messageId <= session.lastPromptId!))) return;
    if (this.turns.size >= MAX_TURNS) {
      const old = [...this.turns.values()].find((turn) => turn.settled || turn.uncertain);
      if (!old) { this.gap(input.at, input.eventId, 'capacity'); return; }
      this.turns.delete(old.id);
      for (const [messageId, turnId] of this.messages) if (turnId === old.id) this.messages.delete(messageId);
    }
    const turn: Turn = { id, sessionId: input.sessionId, messageId: input.messageId, settled: false, uncertain: false, requests: new Map() };
    this.turns.set(id, turn);
    session.currentTurn = id;
    session.lastPromptAt = input.at;
    session.lastPromptId = input.messageId;
    this.publish(turn, input, 'turn-started');
  }

  private assistant(input: Extract<OpencodeActivityInput, { type: 'assistant' }>): void {
    const turn = this.turns.get(`${input.sessionId}:${input.parentId}`);
    if (!turn || turn.settled) return;
    const previous = turn.assistant;
    if (previous && (input.createdAt < previous.createdAt || (input.createdAt === previous.createdAt && input.messageId < previous.messageId))) return;
    if (previous?.messageId === input.messageId && previous.completed && !input.completed) return;
    this.messages.set(input.messageId, turn.id);
    if (this.messages.size > 4096) { this.gap(input.at, input.eventId, 'capacity'); return; }
    turn.assistant = input;
    if (this.sessions.get(turn.sessionId)?.idle) this.finish(turn, input);
  }

  private request(input: Extract<OpencodeActivityInput, { type: 'request' }>): void {
    const turn = input.messageId ? this.turns.get(this.messages.get(input.messageId) ?? '') : undefined;
    if (!turn || turn.sessionId !== input.sessionId || turn.settled) { this.gap(input.at, input.eventId, 'unmatched-event'); return; }
    if (turn.requests.has(input.requestId)) return;
    if (turn.requests.size >= MAX_REQUESTS) { this.gap(input.at, input.eventId, 'capacity'); return; }
    turn.requests.set(input.requestId, input.requestKind);
    this.publish(turn, input, 'request-opened', { id: input.requestId, kind: input.requestKind });
  }

  private resolve(input: Extract<OpencodeActivityInput, { type: 'resolved' }>): void {
    for (const turn of this.turns.values()) {
      const kind = turn.requests.get(input.requestId);
      if (!kind || turn.sessionId !== input.sessionId) continue;
      turn.requests.delete(input.requestId);
      this.publish(turn, input, 'request-resolved', { id: input.requestId, kind, resolution: input.resolution });
      return;
    }
  }

  private finish(turn: Turn, input: OpencodeActivityInput): void {
    const assistant = turn.assistant;
    if (turn.settled) return;
    const error = assistant?.completed ? assistant.error : undefined;
    const completed = assistant?.completed && assistant.finish === 'stop';
    if (!error && !completed) {
      if (!turn.uncertain && turn.requests.size === 0) {
        turn.uncertain = true;
        this.publish(turn, input, 'turn-unconfirmed');
      }
      return;
    }
    // 相同消息的终止错误优先；中断的 idle 可能先于最后 message.updated 到达。
    for (const [id, kind] of turn.requests) this.publish(turn, input, 'request-resolved', { id, kind, resolution: 'withdrawn' });
    turn.requests.clear();
    turn.settled = true;
    this.publish(turn, input, error === 'MessageAbortedError' ? 'turn-cancelled' : error ? 'turn-failed' : 'turn-completed');
  }

  private publish(turn: Turn, input: OpencodeActivityInput, kind: NativeActivitySignal['kind'], request?: NativeActivitySignal['request']): void {
    this.emit({ source: 'opencode/1.18.29', sourceEventId: `${input.eventId}:${kind}${request ? `:${request.id}` : ''}`, occurredAt: input.at, nativeSessionId: turn.sessionId, turnId: turn.id, kind, ...(request ? { request } : {}), ...(kind === 'turn-unconfirmed' ? { reason: 'no-outcome' as const } : {}) });
  }
}
