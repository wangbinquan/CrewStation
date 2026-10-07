// 两种运行策略（链式 one-shot ／ 常驻流）的公共部分：事件工厂、会话 id 认领、终止事件与清理。
// ← agent-workflow `execution/agentProcess.ts` 的 outcome 映射思路，但那里的产物是一条汇总记录，
// 这里的产物是一条 AgentEvent 流。

import { unsupportedDevelopmentNativeUsageCapture } from './usage/developmentNativeCapture';
import type { DevelopmentRunnerUsageCapture } from '@crewstation/contracts';
import { unsupportedNativeUsageCapture, type NativeUsageCapture } from './usage/nativeCapture';
import { createUsageObserver } from './usage/capture';
import type { AgentEvent, AgentEventType, KnownAgentProtocol } from '@crewstation/contracts';
import type { DriverAgentProcess, DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import { DriverStateError } from '../contract/agentDriver';
import type { DriverChildProcess } from '../contract/processHost';
import type { PreparedRuntime } from './cliRuntimeAdapter';
import type { AgentEventFields, TokenUsage } from './agentEventMapping';
import { createAgentEventFactory, emptyTokenUsage } from './agentEventMapping';
import type { EventStream } from './eventStream';
import { createEventStream } from './eventStream';

/** 杀进程树时给 SIGTERM 的宽限；到期升级 SIGKILL（宿主 processTree.ts 实现）。 */
export const CANCEL_GRACE_MS = 5000;

export abstract class AgentRunBase implements DriverAgentProcess {
  readonly events: EventStream<AgentEvent>;
  protected readonly event: ReturnType<typeof createAgentEventFactory>;
  protected readonly usage: TokenUsage = emptyTokenUsage();
  protected readonly startedAt = Date.now();
  protected sessionId: string | undefined;
  protected cancelled = false;
  protected child: DriverChildProcess | undefined;
  protected readonly usageObserver: ReturnType<typeof createUsageObserver> | undefined;

  constructor(
    protected readonly spec: DriverAgentSpec,
    protected readonly context: DriverLaunchContext,
    protected readonly prepared: PreparedRuntime,
    protected readonly protocol: KnownAgentProtocol,
  ) {
    this.events = createEventStream<AgentEvent>(spec.businessEvents ? 4 * 1024 * 1024 : undefined);
    this.event = createAgentEventFactory(spec.agentId);
    this.usageObserver = (spec.businessEvents || context.usageSink !== undefined) && spec.developmentNativePagesV2 !== 2 && spec.usageObservationsV1 === 1 && prepared.normalizeUsage
      ? createUsageObserver(prepared.normalizeUsage, spec.agentId, spec.resumeSessionId) : undefined;
  }

  abstract send(text: string): Promise<void>;
  /** 子类等待自己正在进行的轮次结束。 */
  protected abstract settle(): Promise<void>;

  async cancel(): Promise<void> {
    if (this.events.closed && !this.child) return;
    this.cancelled = true;
    const child = this.child;
    if (child !== undefined) await this.context.host.killTree(child, CANCEL_GRACE_MS);
    await this.settle().catch(() => undefined);
    if (this.events.closed) return;
    this.push(this.event('cancelled', { result: this.result() }));
    this.close();
  }

  protected retryUsageModels(): void {
    for (const usageCapture of this.usageObserver?.retryModels(Date.now()) ?? []) this.push(this.emit('usage', { usageCapture }));
  }

  protected async beginNativeCapture(env: Readonly<Record<string, string | undefined>>, resumeSessionId?: string, resident = false): Promise<NativeUsageCapture | undefined> {
    if (this.spec.developmentNativeSourceV1 === 1 && (!this.context.usageSink || this.spec.businessEvents)) throw new DriverStateError('development_source_requires_sink', '开发实际来源需要独立数字通道');
    if (this.spec.nativeUsageTreeV1 !== 1 || !this.usageObserver || !this.spec.nativeUsageLineageKey) return undefined;
    const turn = this.usageObserver.currentTurn();
    const input = { lineageKey: this.spec.nativeUsageLineageKey, turn: turn.turnId, turnIndex: turn.turnIndex,
      resumeSessionId, ...(this.spec.developmentNativeSourceV1 === 1 ? { developmentNativeSourceV1: 1 as const } : {}), nextRevision: () => this.usageObserver!.nextRevision() };
    const capture = !resident && this.prepared.nativeUsageCapture ? this.prepared.nativeUsageCapture(input, env) : this.spec.developmentNativeSourceV1 === 1 ? unsupportedDevelopmentNativeUsageCapture(input) : unsupportedNativeUsageCapture(input);
    if (capture.normalizeUsage) this.usageObserver.setNormalizer(capture.normalizeUsage);
    const begin = capture.begin(Date.now());
    if (this.persistSource(begin)) return capture;
    const event = this.emit('usage', { usageCapture: begin });
    if (!this.persistUsage(event)) await this.events.writeProcessed(event);
    return capture;
  }

  protected async finishNativeCapture(capture: NativeUsageCapture | undefined, issues: string[] = []): Promise<void> {
    for (const usageCapture of capture?.finish(this.sessionId ?? this.spec.resumeSessionId, Date.now(), issues) ?? []) {
      if (this.persistSource(usageCapture)) continue;
      const event = this.emit('usage', { usageCapture });
      // The final receipt also leaves room for the following business terminal event.
      if (this.persistUsage(event)) continue;
      if (usageCapture.nativeProof) await this.events.writeProcessed(event);
      else await this.events.write(event);
    }
  }

  private persistSource(capture: DevelopmentRunnerUsageCapture): boolean {
    if (!capture.nativeSource) return false;
    try { this.context.usageSink?.(capture, capture.nativeSource.observedAt); }
    catch { this.context.logger.warn('numeric usage sink unavailable'); }
    return true;
  }

  protected push(event: AgentEvent): void {
    if (!this.persistUsage(event)) this.events.push(event);
  }

  private persistUsage(event: AgentEvent): boolean {
    if (event.type !== 'usage' || !event.usageCapture || !this.context.usageSink) return false;
    try { this.context.usageSink(event.usageCapture, event.at); }
    catch { this.context.logger.warn('numeric usage sink unavailable'); }
    return true;
  }

  protected emit(type: AgentEventType, fields?: AgentEventFields, at?: number): AgentEvent {
    return this.event(type, fields, at);
  }

  /** 首个事件：只记录不含凭据的规格摘要（MCP 只记名字，env 一概不记，二进制路径属于管理面也不记）。 */
  protected emitStarted(): void {
    const model = this.spec.launch.model;
    this.push(this.emit('started', {
      // spec 是契约字段：工作台的 Agent 列表按持久事件还原，没有它只能编造档位、协议与权限（RFC-006：档位名＋修订＋协议）。
      spec: { compute: this.spec.compute, profileRevision: this.spec.profileRevision, protocol: this.protocol, ...(model === undefined ? {} : { model }), permission: this.spec.permission },
      raw: {
        protocol: this.protocol,
        mode: this.spec.mode,
        ...(model === undefined ? {} : { model }),
        permission: this.spec.permission,
        mcp: this.spec.mcp.map((m) => m.name),
        systemPrompt: this.spec.systemPrompt !== undefined,
        resume: this.spec.resumeSessionId !== undefined,
      },
    }));
  }

  protected claimSession(sessionId: string): void {
    if (sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    this.push(this.emit('session', { sessionId }));
  }

  protected result(extra: { summary?: string; exitCode?: number } = {}): AgentEvent['result'] {
    return {
      ...(extra.summary === undefined ? {} : { summary: extra.summary }),
      ...(extra.exitCode === undefined ? {} : { exitCode: extra.exitCode }),
      usage: { ...this.usage },
      durationMs: Date.now() - this.startedAt,
    };
  }

  protected finishCompleted(exitCode: number | null): void {
    if (this.events.closed) return;
    this.push(this.emit('completed', { result: this.result({ ...(exitCode === null ? {} : { exitCode }) }) }));
    this.close();
  }

  protected finishFailed(code: string, message: string, exitCode: number | null): void {
    if (this.events.closed) return;
    this.push(this.emit('error', { error: { code, message }, result: this.result({ ...(exitCode === null ? {} : { exitCode }) }) }));
    this.close();
  }

  protected close(): void {
    this.events.close();
    this.prepared.dispose();
  }

  protected assertCanSend(): void {
    if (this.spec.mode !== 'interactive') throw new DriverStateError('agent_not_interactive', 'oneshot Agent 不接受后续消息');
    if (this.events.closed) throw new DriverStateError('agent_not_running', 'Agent 已结束');
  }
}

/** 失败时把 stderr 尾部裁成一条可读的 error 文案。 */
export function failureMessage(driverName: string, exitCode: number | null, signalCode: string | null, stderrTail: string): string {
  const how = signalCode !== null ? `被信号 ${signalCode} 终止` : `退出码 ${exitCode ?? 'null'}`;
  const tail = stderrTail.trim().split('\n').slice(-20).join('\n');
  return tail.length > 0 ? `${driverName} ${how}：\n${tail}` : `${driverName} ${how}`;
}
