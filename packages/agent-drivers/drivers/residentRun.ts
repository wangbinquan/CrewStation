// 常驻交互流：一个长活进程，后续消息逐帧写进它的 stdin，全程共用同一个原生会话。
// **agent-workflow 里没有这条路径**（复制清单 §10：源的 stdin 只有 ignore 与「写一次即关闭」两种）。
// 只有 Claude Code 支持：`-p --input-format stream-json --output-format stream-json --verbose` 下
// 进程在每个 `result` 之后继续读 stdin 的下一行，stdin EOF 才退出（见 claudeCode/streamInput.ts 的依据与残余风险）。

import type { AgentEvent, KnownAgentProtocol } from '@crewstation/contracts';
import { DriverStateError } from '../contract/agentDriver';
import type { DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import type { DriverChildProcessWithStdin } from '../contract/processHost';
import type { PreparedRuntime } from './cliRuntimeAdapter';
import { AgentRunBase, failureMessage } from './agentRunBase';
import { pumpTurn } from './turnPump';

export class ResidentAgentRun extends AgentRunBase {
  private stream: DriverChildProcessWithStdin | undefined;
  private lifetime: Promise<void>;
  private turnError: string | null = null;

  constructor(spec: DriverAgentSpec, context: DriverLaunchContext, prepared: PreparedRuntime, protocol: KnownAgentProtocol) {
    super(spec, context, prepared, protocol);
    if (prepared.encodeStreamFrame === undefined) throw new DriverStateError('driver_misconfigured', '常驻运行需要适配器提供输入帧编码');
    this.lifetime = this.begin();
  }

  async send(text: string): Promise<void> {
    this.assertCanSend();
    const stream = this.stream;
    if (stream === undefined) throw new DriverStateError('agent_not_running', 'Agent 尚未拉起或已退出');
    this.writeFrame(stream, text);
    await Promise.resolve();
  }

  protected settle(): Promise<void> {
    return this.lifetime;
  }

  private writeFrame(stream: DriverChildProcessWithStdin, text: string): void {
    // encodeStreamFrame 在构造器里已经确认存在。
    stream.stdin.write((this.prepared.encodeStreamFrame as (t: string) => string)(text));
    stream.stdin.flush?.();
  }

  private async begin(): Promise<void> {
    this.emitStarted();
    const plan = this.prepared.plan({
      prompt: this.spec.initialPrompt ?? '',
      ...(this.spec.resumeSessionId === undefined ? {} : { resumeSessionId: this.spec.resumeSessionId }),
      resident: true,
    });
    let stream: DriverChildProcessWithStdin;
    try {
      stream = this.context.host.spawnWithStdin({ cmd: plan.cmd, cwd: this.context.cwd, env: plan.env });
    } catch (error) {
      this.finishFailed('spawn_failed', error instanceof Error ? error.message : String(error), null);
      return;
    }
    this.stream = stream;
    this.child = stream;
    if (this.spec.initialPrompt !== undefined && this.spec.initialPrompt.length > 0) {
      this.writeFrame(stream, this.spec.initialPrompt);
    }
    await this.consume(stream);
  }

  private async consume(stream: DriverChildProcessWithStdin): Promise<void> {
    const result = await pumpTurn(stream, {
      host: this.context.host,
      logger: this.context.logger,
      usage: this.usage,
      emit: (type, fields, at) => this.emit(type, fields, at),
      push: (event: AgentEvent) => this.push(event),
      parseEvent: (line) => this.prepared.parseEvent(line),
      onSessionId: (sessionId) => this.claimSession(sessionId),
      onTurnFinished: (error) => this.onTurnFinished(error),
    });
    this.stream = undefined;
    this.child = undefined;
    if (this.cancelled) return;
    if (result.exitCode !== 0) {
      const code = this.prepared.detectSessionNotFound(result.stderrTail) ? 'session_not_found' : 'agent_failed';
      this.finishFailed(code, failureMessage(this.protocol, result.exitCode, result.signalCode, result.stderrTail), result.exitCode);
      return;
    }
    if (this.turnError !== null) {
      this.finishFailed('agent_reported_error', this.turnError, result.exitCode);
      return;
    }
    this.finishCompleted(result.exitCode);
  }

  /** 每个 `result` 结束一轮：常驻进程不退出，只回到等待下一条消息的状态。 */
  private onTurnFinished(error: string | null): void {
    this.turnError = error;
    if (this.events.closed || this.cancelled) return;
    this.push(this.emit('status', { status: 'waiting' }));
  }
}
