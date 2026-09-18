import { isAbsolute, posix } from 'node:path';
import type { AgentEvent, AgentEventType, KnownAgentProtocol } from '@crewstation/contracts';
import { RunnerCommandError } from '../src/commandError';
import type { AgentDriver, AgentDriverFactory, AgentEventFields, AgentLaunchContext, AgentProcess, AgentSpec } from '../src/agents/driver';
import { createAgentEventFactory } from '../src/agents/driver';
import { createEventQueue } from '../src/agents/eventQueue';
import { splitChunk } from '../src/process/streamPump';

export const ECHO_CHUNK_CHARS = 16;
/** 提示词里出现 `WRITE <相对路径>: <文本>` 时，以 worker 身份把文本写入 cwd 下该文件（测试隔离与降权用）。 */
const WRITE_DIRECTIVE = /WRITE\s+(\S+?):\s?([^\n]*)/;
const WRITE_SCRIPT = 'mkdir -p -- "$(dirname -- "$1")" && printf %s "$2" > "$1"';

export interface EchoDriverFactory extends AgentDriverFactory {
  /** 每次 start 收到的规格与托管上下文，供断言“命令里的 launch 原样到达驱动”。 */
  readonly starts: Array<{ spec: AgentSpec; context: AgentLaunchContext }>;
}

/**
 * 测试替身，只在 tests/ 里：确定性的回显 Agent。`started` → `session` → 若干回显 `text` → `completed`；
 * 交互模式下常驻，每条 sendMessage 回显一次，直到 cancelAgent。经 RunnerHooks.drivers 注入，与真实驱动同一接缝。
 * 不读 mcp／env 的值，只把名字与键记录在 `started.raw`。
 */
export function echoDriverFactory(): EchoDriverFactory {
  const starts: EchoDriverFactory['starts'] = [];
  const driver = (protocol: KnownAgentProtocol): AgentDriver => ({
    protocol,
    start: (spec, context) => {
      starts.push({ spec, context });
      return new EchoAgent(protocol, spec, context);
    },
  });
  return { starts, forProtocol: driver };
}

class EchoAgent implements AgentProcess {
  readonly events = createEventQueue<AgentEvent>();
  private readonly event: ReturnType<typeof createAgentEventFactory>;
  private readonly startedAt = Date.now();
  private cancelled = false;
  private echoedChars = 0;
  private turn: Promise<void>;

  constructor(private readonly protocol: KnownAgentProtocol, private readonly spec: AgentSpec, private readonly context: AgentLaunchContext) {
    this.event = createAgentEventFactory(spec.agentId);
    this.turn = this.begin();
  }

  async send(text: string): Promise<void> {
    if (this.spec.mode !== 'interactive') throw new RunnerCommandError('agent_not_interactive', 'oneshot Agent 不接受后续消息');
    if (this.events.closed) throw new RunnerCommandError('agent_not_running', 'Agent 已结束');
    this.turn = this.turn.then(() => this.echo(text)).then(() => {
      if (!this.cancelled) this.emit('status', { status: 'waiting' });
    });
    await this.turn;
  }

  async cancel(): Promise<void> {
    if (this.events.closed) return;
    this.cancelled = true;
    await this.turn.catch(() => undefined);
    this.emit('cancelled', { result: { durationMs: Date.now() - this.startedAt } });
    this.events.close();
  }

  private emit(type: AgentEventType, fields?: AgentEventFields): void {
    this.events.push(this.event(type, fields));
  }

  private async begin(): Promise<void> {
    const { spec, context } = this;
    this.emit('started', {
      spec: { compute: spec.compute, profileRevision: spec.profileRevision, protocol: this.protocol, ...(spec.launch.model ? { model: spec.launch.model } : {}), permission: spec.permission },
      raw: {
        mode: spec.mode, binaryPath: spec.launch.binaryPath, extraArgs: spec.launch.extraArgs, mcp: spec.mcp.map((m) => m.name),
        envKeys: Object.keys(context.env).sort(), homeIsPrivate: context.env.HOME === context.managed.home, systemPrompt: spec.systemPrompt !== undefined,
      },
    });
    this.emit('session', { sessionId: spec.resumeSessionId ?? `echo-${spec.agentId}` });
    if (spec.initialPrompt !== undefined) await this.echo(spec.initialPrompt);
    if (this.cancelled) return;
    if (spec.mode === 'oneshot') this.finish();
    else this.emit('status', { status: 'waiting' });
  }

  private async echo(prompt: string): Promise<void> {
    await this.applyWriteDirective(prompt);
    for (const chunk of splitChunk(prompt, ECHO_CHUNK_CHARS)) {
      if (this.cancelled) return;
      this.emit('text', { text: chunk });
      this.echoedChars += chunk.length;
      await Bun.sleep(1);
    }
  }

  private finish(): void {
    if (this.events.closed) return;
    this.emit('completed', { result: { summary: `echoed ${this.echoedChars} chars`, exitCode: 0, durationMs: Date.now() - this.startedAt } });
    this.events.close();
  }

  private async applyWriteDirective(prompt: string): Promise<void> {
    const match = WRITE_DIRECTIVE.exec(prompt);
    if (!match) return;
    const path = match[1] ?? '';
    const text = match[2] ?? '';
    const callId = `write-${this.echoedChars}`;
    if (isAbsolute(path) || posix.normalize(path).startsWith('..')) {
      this.emit('error', { error: { code: 'path_denied', message: `WRITE 只接受 cwd 内的相对路径：${path}` } });
      return;
    }
    this.emit('tool-start', { tool: { callId, name: 'write', input: { path } } });
    const proc = this.context.launcher.spawnPiped({ cmd: ['sh', '-c', WRITE_SCRIPT, 'echo-write', path, text], cwd: this.context.cwd, env: this.context.env });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    this.emit('tool-end', { tool: { callId, name: 'write', output: { path, exitCode }, isError: exitCode !== 0 } });
    if (exitCode !== 0) this.emit('error', { error: { code: 'write_failed', message: stderr.trim() || `exit ${exitCode}` } });
  }
}
