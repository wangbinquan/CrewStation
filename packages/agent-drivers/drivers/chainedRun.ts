// 链式 one-shot：一轮一进程，后续轮用 CLI 自己的会话恢复标志接上同一个对话。
// oneshot 模式下两个 CLI 都走这里（与 agent-workflow 完全一致）；交互模式下 OpenCode 走这里，
// 因为 `opencode run` 的 message 是位置参数、没有任何 stdin 流入口（`opencode run --help`，1.18.29 实测）。

import type { AgentDriver, AgentEvent } from '@crewstation/contracts';
import { DriverStateError } from '../contract/agentDriver';
import type { DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import type { DriverChildProcess } from '../contract/processHost';
import type { PreparedRuntime } from './cliRuntimeAdapter';
import { AgentRunBase, failureMessage } from './agentRunBase';
import { pumpTurn } from './turnPump';

export class ChainedAgentRun extends AgentRunBase {
  private turn: Promise<void>;

  constructor(spec: DriverAgentSpec, context: DriverLaunchContext, prepared: PreparedRuntime, driverName: AgentDriver) {
    super(spec, context, prepared, driverName);
    this.turn = this.begin();
  }

  async send(text: string): Promise<void> {
    this.assertCanSend();
    this.turn = this.turn.then(() => this.runTurn(text));
    await this.turn;
  }

  protected settle(): Promise<void> {
    return this.turn;
  }

  private async begin(): Promise<void> {
    this.emitStarted();
    const prompt = this.spec.initialPrompt;
    if (prompt === undefined || prompt.length === 0) {
      if (this.spec.mode === 'oneshot') {
        this.finishFailed('missing_prompt', 'oneshot Agent 需要 initialPrompt', null);
        return;
      }
      this.push(this.emit('status', { status: 'waiting' }));
      return;
    }
    await this.runTurn(prompt);
  }

  private async runTurn(prompt: string): Promise<void> {
    if (this.cancelled || this.events.closed) return;
    let turnError: string | null = null;
    let child: DriverChildProcess;
    try {
      child = this.spawn(prompt);
    } catch (error) {
      this.finishFailed('spawn_failed', error instanceof Error ? error.message : String(error), null);
      return;
    }
    this.child = child;
    const result = await pumpTurn(child, {
      host: this.context.host,
      logger: this.context.logger,
      usage: this.usage,
      emit: (type, fields, at) => this.emit(type, fields, at),
      push: (event: AgentEvent) => this.push(event),
      parseEvent: (line) => this.prepared.parseEvent(line),
      onSessionId: (sessionId) => this.claimSession(sessionId),
      onTurnFinished: (error) => {
        turnError = error;
      },
    });
    this.child = undefined;
    if (this.cancelled) return;
    this.concludeTurn(result, turnError);
  }

  private concludeTurn(result: Awaited<ReturnType<typeof pumpTurn>>, turnError: string | null): void {
    if (result.exitCode !== 0) {
      const sessionGone = this.prepared.detectSessionNotFound(result.stderrTail);
      const code = sessionGone ? 'session_not_found' : 'agent_failed';
      this.finishFailed(code, failureMessage(this.driverName, result.exitCode, result.signalCode, result.stderrTail), result.exitCode);
      return;
    }
    // 干净退出但运行时自报终止错误（Claude 的 `result.is_error`：鉴权失败／API 报错）。
    if (turnError !== null) {
      this.finishFailed('agent_reported_error', turnError, result.exitCode);
      return;
    }
    if (this.spec.mode === 'oneshot') {
      this.finishCompleted(result.exitCode);
      return;
    }
    this.push(this.emit('status', { status: 'waiting' }));
  }

  private spawn(prompt: string): DriverChildProcess {
    const plan = this.prepared.plan({
      prompt,
      ...(this.resumeIdFor() === undefined ? {} : { resumeSessionId: this.resumeIdFor() }),
      resident: false,
    });
    const spec = { cmd: plan.cmd, cwd: this.context.cwd, env: plan.env };
    if (plan.stdin.mode === 'ignore') return this.context.host.spawnPiped(spec);
    if (plan.stdin.mode === 'stream') throw new DriverStateError('driver_misconfigured', '链式运行不接受常驻输入流');
    const child = this.context.host.spawnWithStdin(spec);
    // ← 源 managedProcess.ts：`pipe` 模式一次 write 后立即 end，CLI 据此知道输入结束。
    child.stdin.write(plan.stdin.data);
    child.stdin.end();
    return child;
  }

  /** 第一轮用调用方给的 resumeSessionId，之后用本次运行捕获到的原生会话 id。 */
  private resumeIdFor(): string | undefined {
    return this.sessionId ?? this.spec.resumeSessionId;
  }
}
