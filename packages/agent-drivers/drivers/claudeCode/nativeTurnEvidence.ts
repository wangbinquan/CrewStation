/** 只保留 Claude 2.1.268 transcript 的结构字段，正文与工具参数不进入状态模型。 */
export interface ClaudeTranscriptNode {
  id: string;
  parentId: string | null;
  sessionId: string;
  promptId?: string;
  humanPrompt: boolean;
  assistant: boolean;
  assistantFinish?: string;
  apiError?: boolean;
  interrupted?: boolean;
  turnDuration: boolean;
}

export type ClaudeTurnOutcome = 'completed' | 'cancelled' | 'failed' | 'unconfirmed';
interface Turn {
  sessionId: string;
  promptId: string;
  ended: boolean;
  failed: boolean;
  interrupted: boolean;
  duration?: { finalAnswer: boolean; apiError: boolean };
  published?: ClaudeTurnOutcome;
}

const key = (sessionId: string, promptId: string) => `${sessionId}:${promptId}`;

/**
 * Stop、interaction end 或 turn_duration 任意一项都不能单独判成功。
 * 只有完整父链指向本轮用户输入，最后 assistant 为 end_turn，且 interaction 已结束，才确认完成。
 */
export class ClaudeNativeTurnEvidence {
  private readonly nodes = new Map<string, ClaudeTranscriptNode>();
  private readonly turns = new Map<string, Turn>();
  private readonly durations = new Set<string>();
  private unavailable = false;
  constructor(private readonly emit: (sessionId: string, promptId: string, outcome: ClaudeTurnOutcome) => void, private readonly onUnavailable: () => void) {}

  start(sessionId: string, promptId: string): void {
    const id = key(sessionId, promptId);
    if (this.turns.has(id) || this.unavailable) return;
    if (this.turns.size >= 128) {
      const old = [...this.turns.entries()].find(([, turn]) => turn.ended);
      if (!old) { this.failSource(); return; }
      this.turns.delete(old[0]);
    }
    const interrupted = [...this.nodes.values()].some((node) => node.sessionId === sessionId && node.promptId === promptId && node.interrupted);
    this.turns.set(id, { sessionId, promptId, ended: false, failed: false, interrupted });
    this.reconcileDurations();
  }

  end(sessionId: string, promptId: string): void {
    const turn = this.turns.get(key(sessionId, promptId));
    if (!turn || this.unavailable) return;
    turn.ended = true;
    this.publish(turn);
  }

  failure(sessionId: string, promptId: string): void {
    const turn = this.turns.get(key(sessionId, promptId));
    if (!turn || this.unavailable) return;
    turn.failed = true;
    this.publish(turn);
  }

  observe(node: ClaudeTranscriptNode): void {
    if (this.unavailable || this.nodes.has(node.id)) return;
    if (this.nodes.size >= 8192) this.nodes.delete(this.nodes.keys().next().value!);
    this.nodes.set(node.id, node);
    if (node.interrupted && node.promptId) {
      const turn = this.turns.get(key(node.sessionId, node.promptId));
      if (turn) { turn.interrupted = true; this.publish(turn); }
    }
    if (node.turnDuration) {
      if (this.durations.size >= 128) { this.failSource(); return; }
      this.durations.add(node.id);
    }
    this.reconcileDurations();
  }

  private reconcileDurations(): void {
    for (const id of this.durations) {
      const resolved = this.resolveDuration(id);
      if (!resolved) continue;
      const turn = this.turns.get(key(resolved.sessionId, resolved.promptId));
      if (!turn) continue;
      turn.duration = { finalAnswer: resolved.finish === 'end_turn', apiError: resolved.apiError };
      this.durations.delete(id);
      this.publish(turn);
    }
  }

  private resolveDuration(id: string): { sessionId: string; promptId: string; finish?: string; apiError: boolean } | undefined {
    const duration = this.nodes.get(id);
    if (!duration) return;
    const seen = new Set<string>();
    let current = duration.parentId, finish: string | undefined, assistantSeen = false, apiError = false;
    let promptId: string | undefined;
    while (current && seen.size < 8192) {
      if (seen.has(current)) { this.failSource(); return; }
      seen.add(current);
      const node = this.nodes.get(current);
      if (!node || node.sessionId !== duration.sessionId) return;
      if (node.promptId) {
        if (promptId && promptId !== node.promptId) return;
        promptId = node.promptId;
      }
      if (node.humanPrompt) return node.promptId ? { sessionId: node.sessionId, promptId: node.promptId, ...(finish ? { finish } : {}), apiError } : undefined;
      if (!assistantSeen && node.assistant) {
        assistantSeen = true; finish = node.assistantFinish; apiError = node.apiError ?? false;
      }
      current = node.parentId;
    }
    return;
  }

  private publish(turn: Turn): void {
    if (!turn.ended || this.unavailable) return;
    const outcome: ClaudeTurnOutcome = turn.interrupted ? 'cancelled' : turn.failed || turn.duration?.apiError ? 'failed' : turn.duration?.finalAnswer ? 'completed' : 'unconfirmed';
    if (outcome === turn.published) return;
    turn.published = outcome;
    this.emit(turn.sessionId, turn.promptId, outcome);
  }

  private failSource(): void {
    if (this.unavailable) return;
    this.unavailable = true;
    this.onUnavailable();
  }
}
