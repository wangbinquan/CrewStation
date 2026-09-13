import type { NativeActivitySignal } from '@crewstation/contracts';
import type { ClaudeNativeHook } from './nativeObservation';
import type { ClaudeNativeTelemetry } from './nativeTelemetry';
import { ClaudeNativeTurnEvidence, type ClaudeTranscriptNode, type ClaudeTurnOutcome } from './nativeTurnEvidence';

interface Tool { id: string; name: string; inputHash: string; waiting: boolean }
interface Turn { sessionId: string; promptId: string; ended: boolean; tools: Map<string, Tool> }
interface Trace { sessionId: string; promptId?: string; ended: boolean; receivedAt: number }
const turnKey = (session: string, prompt: string) => `${session}:${prompt}`;

/** 原生 hook、OTel 轮次与 transcript 相互核对，永不读取终端输出。 */
export class ClaudeNativeActivity {
  private readonly sessions = new Set<string>();
  private readonly turns = new Map<string, Turn>();
  private readonly traces = new Map<string, Trace>();
  private readonly evidence: ClaudeNativeTurnEvidence;
  private degraded = false;
  private ready = false;
  constructor(private readonly emit: (signal: NativeActivitySignal) => void) {
    this.evidence = new ClaudeNativeTurnEvidence((session, prompt, outcome) => this.outcome(session, prompt, outcome), () => this.gap('capacity'));
  }

  hook(hook: ClaudeNativeHook): void {
    if (this.degraded || hook.child) return;
    if (hook.type === 'SessionStart') {
      if (this.sessions.size >= 128 && !this.sessions.has(hook.sessionId)) { this.gap('capacity'); return; }
      this.sessions.add(hook.sessionId);
      if (!this.ready) { this.ready = true; this.signal('source-ready'); }
      return;
    }
    if (!this.sessions.has(hook.sessionId)) { this.gap('unmatched-event'); return; }
    if (hook.type === 'ConfigChange') { this.gap('source-error'); return; }
    if (!hook.promptId) { this.gap('unmatched-event'); return; }
    const key = turnKey(hook.sessionId, hook.promptId);
    if (hook.type === 'UserPromptSubmit') { this.start(hook.sessionId, hook.promptId); return; }
    const turn = this.turns.get(key);
    if (!turn) { this.gap('unmatched-event'); return; }
    if (turn.ended) return;
    if (hook.type === 'StopFailure') { this.evidence.failure(hook.sessionId, hook.promptId); return; }
    this.toolHook(turn, hook);
  }

  telemetry(event: ClaudeNativeTelemetry): void {
    if (this.degraded || event.type === 'heartbeat' || !this.sessions.has(event.sessionId)) return;
    const id = `${event.traceId}:${event.spanId}`;
    let trace = this.traces.get(id);
    if (!trace) {
      if (this.traces.size >= 512) {
        const old = [...this.traces].find(([, item]) => item.ended && item.promptId && this.turns.get(turnKey(item.sessionId, item.promptId))?.ended);
        if (!old) { this.gap('capacity'); return; }
        this.traces.delete(old[0]);
      }
      trace = { sessionId: event.sessionId, ended: false, receivedAt: Date.now() };
      this.traces.set(id, trace);
    }
    if (trace.sessionId !== event.sessionId || (event.type === 'prompt-trace' && trace.promptId && trace.promptId !== event.promptId)) { this.gap('unmatched-event'); return; }
    if (event.type === 'prompt-trace') trace.promptId = event.promptId;
    else trace.ended = true;
    this.reconcile(trace);
  }

  transcript(node: ClaudeTranscriptNode): void {
    if (!this.degraded && this.sessions.has(node.sessionId)) this.evidence.observe(node);
  }

  check(now: number): void {
    // 仅对已到达的结束事件等待跨通道关联；不是用模型输出静默时长判定结束。
    if ([...this.traces.values()].some((trace) => trace.ended && (!trace.promptId || !this.turns.has(turnKey(trace.sessionId, trace.promptId))) && now - trace.receivedAt > 20000)) this.gap('unmatched-event');
  }

  gap(reason: NativeActivitySignal['reason']): void {
    if (this.degraded) return;
    this.degraded = true;
    this.signal('source-unavailable', undefined, { reason });
  }

  private start(sessionId: string, promptId: string): void {
    const key = turnKey(sessionId, promptId);
    if (this.turns.has(key)) return;
    if (this.turns.size >= 128) {
      const old = [...this.turns].find(([, turn]) => turn.ended);
      if (!old) { this.gap('capacity'); return; }
      this.turns.delete(old[0]);
      for (const [traceId, trace] of this.traces) if (trace.promptId && turnKey(trace.sessionId, trace.promptId) === old[0]) this.traces.delete(traceId);
    }
    const turn: Turn = { sessionId, promptId, ended: false, tools: new Map() };
    this.turns.set(key, turn);
    this.evidence.start(sessionId, promptId);
    this.signal('turn-started', turn);
    for (const trace of this.traces.values()) this.reconcile(trace);
  }

  private reconcile(trace: Trace): void {
    if (!trace.ended || !trace.promptId || !this.turns.has(turnKey(trace.sessionId, trace.promptId))) return;
    this.evidence.end(trace.sessionId, trace.promptId);
  }

  private toolHook(turn: Turn, hook: ClaudeNativeHook): void {
    if (hook.type === 'PreToolUse') {
      if (!hook.toolId || !hook.toolName || !hook.inputHash) { this.gap('unmatched-event'); return; }
      if (turn.tools.has(hook.toolId)) return;
      if (turn.tools.size >= 64) { this.gap('capacity'); return; }
      turn.tools.set(hook.toolId, { id: hook.toolId, name: hook.toolName, inputHash: hook.inputHash, waiting: false });
    } else if (hook.type === 'PermissionRequest') {
      const candidates = [...turn.tools.values()].filter((tool) => tool.name === hook.toolName && tool.inputHash === hook.inputHash);
      // 固定版本 PermissionRequest 缺 tool_use_id；多个相同并行调用不能按先后猜身份。
      if (candidates.length !== 1) { this.gap('unmatched-event'); return; }
      const tool = candidates[0]!;
      if (tool.waiting) return;
      tool.waiting = true;
      this.signal('request-opened', turn, { request: { id: tool.id, kind: tool.name === 'AskUserQuestion' ? 'question' : 'permission' } });
    } else if (hook.type === 'PostToolUse' || hook.type === 'PostToolUseFailure') {
      const tool = hook.toolId ? turn.tools.get(hook.toolId) : undefined;
      if (!tool) return;
      if (tool.waiting) this.resolve(turn, tool, hook.type === 'PostToolUse' ? 'answered' : 'withdrawn');
      turn.tools.delete(tool.id);
    }
  }

  private outcome(sessionId: string, promptId: string, outcome: ClaudeTurnOutcome): void {
    const turn = this.turns.get(turnKey(sessionId, promptId));
    if (!turn || this.degraded) return;
    turn.ended = true;
    for (const tool of turn.tools.values()) if (tool.waiting) this.resolve(turn, tool, 'withdrawn');
    turn.tools.clear();
    this.signal(`turn-${outcome}`, turn, outcome === 'unconfirmed' ? { reason: 'no-outcome' } : {});
  }

  private resolve(turn: Turn, tool: Tool, resolution: 'answered' | 'withdrawn'): void {
    tool.waiting = false;
    this.signal('request-resolved', turn, { request: { id: tool.id, kind: tool.name === 'AskUserQuestion' ? 'question' : 'permission', resolution } });
  }

  private signal(kind: NativeActivitySignal['kind'], turn?: Turn, fields: Pick<NativeActivitySignal, 'request' | 'reason'> = {}): void {
    this.emit({ source: 'claude-code/2.1.268', sourceEventId: crypto.randomUUID(), kind, occurredAt: new Date().toISOString(), nativeSessionId: turn?.sessionId ?? null, turnId: turn ? turnKey(turn.sessionId, turn.promptId) : null, ...fields });
  }
}
