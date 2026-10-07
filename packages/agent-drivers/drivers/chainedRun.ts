import { randomUUID } from 'node:crypto';
import { beginDevelopmentNativePagedCapture } from './usage/developmentNativePagedCapture';
import type { DevelopmentNativePagedCapture } from '../contract/developmentNativeProducer';
// 链式 one-shot：一轮一进程，后续轮用 CLI 自己的会话恢复标志接上同一个对话。
// oneshot 模式下两个 CLI 都走这里（与 agent-workflow 完全一致）；交互模式下 OpenCode 走这里，
// 因为 `opencode run` 的 message 是位置参数、没有任何 stdin 流入口（`opencode run --help`，1.18.29 实测）。

import type { AgentEvent, KnownAgentProtocol } from '@crewstation/contracts';
import { DriverStateError } from '../contract/agentDriver';
import type { DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import type { DriverChildProcess } from '../contract/processHost';
import type { SpawnPlan } from '../contract/spawnPlan';
import type { NativeUsageCapture } from './usage/nativeCapture';
import type { PreparedRuntime } from './cliRuntimeAdapter';
import { AgentRunBase, failureMessage } from './agentRunBase';
import { pumpTurn } from './turnPump';

export class ChainedAgentRun extends AgentRunBase {
  private turn: Promise<void>;
  private nativeTurnIndex = 0;

  constructor(spec: DriverAgentSpec, context: DriverLaunchContext, prepared: PreparedRuntime, protocol: KnownAgentProtocol) {
    super(spec, context, prepared, protocol);
    this.turn = this.begin().catch((error) => { this.events.fail(error); });
  }

  async send(text: string): Promise<void> {
    this.assertCanSend();
    this.turn = this.turn.then(() => this.runTurn(text)).catch((error) => { this.events.fail(error); throw error; });
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
    let native: NativeUsageCapture | undefined;
    let nativePages: DevelopmentNativePagedCapture | undefined;
    const captureUsage = this.usageObserver?.beginTurn((session, id) => native?.includesRecord(session, id) ?? true);
    let child: DriverChildProcess;
    try {
      const plan = this.prepared.plan({ prompt, resumeSessionId: this.resumeIdFor(), resident: false });
      if (this.spec.developmentNativePagesV2 === 2) {
        if (!this.context.developmentNativeProducer || !this.prepared.nativePageBootstrap)
          throw new DriverStateError('development_native_unsupported', '原受理没有可用的原生分页 owner 或驱动');
        await this.initializeNativeSource(plan.env);
        if (this.cancelled || this.events.closed) return;
        nativePages = await beginDevelopmentNativePagedCapture({ producer: this.context.developmentNativeProducer,
          env: plan.env, turn: randomUUID(), turnIndex: this.nativeTurnIndex++, resumeSessionId: this.resumeIdFor() });
      } else if (this.spec.nativeUsageTreeV1 === 1) native = await this.beginNativeCapture(plan.env, this.resumeIdFor());
      if (this.cancelled || this.events.closed) { await this.finishNativeCapture(native, ['native-process-not-started']); return; }
      child = this.spawn(plan);
    } catch (error) {
      if (this.spec.developmentNativePagesV2 === 2) this.context.developmentNativeProducer?.interrupted();
      await this.finishNativeCapture(native, ['native-process-not-started']);
      if (this.cancelled && this.spec.developmentNativePagesV2 === 2) return;
      this.finishFailed('spawn_failed', error instanceof Error ? error.message : String(error), null);
      return;
    }
    this.child = child;
    let result: Awaited<ReturnType<typeof pumpTurn>> | undefined;
    try {
      result = await pumpTurn(child, {
      businessEvents: this.spec.businessEvents,
      captureUsage,
      host: this.context.host,
      logger: this.context.logger,
      usage: this.usage,
      emit: (type, fields, at) => this.emit(type, fields, at),
      push: (event: AgentEvent) => this.push(event),
      parseEvent: (line) => this.prepared.parseEvent(line),
      onSessionId: (sessionId) => { native?.observeSession(sessionId); this.claimSession(sessionId); },
      onTurnFinished: (error) => {
        turnError = error;
      },
    });
    } finally {
      try {
        this.retryUsageModels();
        await this.finishNativeCapture(native, result?.drained ? [] : ['native-output-incomplete']);
        if (nativePages) {
          try { await nativePages.finish(this.sessionId ?? this.spec.resumeSessionId, result?.drained ? [] : ['native-output-incomplete']); }
          catch { this.context.logger.warn('native numeric capture interrupted'); }
        }
      } finally { this.child = undefined; }
    }
    if (this.cancelled) return;
    this.concludeTurn(result, turnError);
  }

  private concludeTurn(result: Awaited<ReturnType<typeof pumpTurn>>, turnError: string | null): void {
    if (result.exitCode !== 0) {
      const sessionGone = this.prepared.detectSessionNotFound(result.stderrTail);
      const code = sessionGone ? 'session_not_found' : 'agent_failed';
      this.finishFailed(code, failureMessage(this.protocol, result.exitCode, result.signalCode, result.stderrTail), result.exitCode);
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

  private async initializeNativeSource(env: Record<string, string>): Promise<void> {
    const plan = this.prepared.nativePageBootstrap!(env);
    const child = this.context.host.spawnPiped({ ...plan, cwd: this.context.cwd });
    this.child = child;
    let timedOut = false, drained = false;
    let killed: Promise<void> | undefined;
    const timer = setTimeout(() => {
      timedOut = true; killed = this.context.host.killTree(child, 0); void killed.catch(() => undefined);
    }, 10_000);
    try {
      const [exit] = await Promise.all([child.exited, this.context.host.pumpLines(child.stdout, () => undefined),
        this.context.host.pumpLines(child.stderr, () => undefined)]);
      drained = true;
      if (killed) await killed;
      if (timedOut || exit !== 0) throw new Error('Selected upstream native database initialization failed');
    } finally { clearTimeout(timer); if (drained) this.child = undefined; }
  }

  private spawn(plan: SpawnPlan): DriverChildProcess {
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
