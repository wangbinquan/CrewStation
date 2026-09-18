// 两种运行策略（链式 one-shot ／ 常驻流）的公共部分：事件工厂、会话 id 认领、终止事件与清理。
// ← agent-workflow `execution/agentProcess.ts` 的 outcome 映射思路，但那里的产物是一条汇总记录，
// 这里的产物是一条 AgentEvent 流。

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
  readonly events: EventStream<AgentEvent> = createEventStream<AgentEvent>();
  protected readonly event: ReturnType<typeof createAgentEventFactory>;
  protected readonly usage: TokenUsage = emptyTokenUsage();
  protected readonly startedAt = Date.now();
  protected sessionId: string | undefined;
  protected cancelled = false;
  protected child: DriverChildProcess | undefined;

  constructor(
    protected readonly spec: DriverAgentSpec,
    protected readonly context: DriverLaunchContext,
    protected readonly prepared: PreparedRuntime,
    protected readonly protocol: KnownAgentProtocol,
  ) {
    this.event = createAgentEventFactory(spec.agentId);
  }

  abstract send(text: string): Promise<void>;
  /** 子类等待自己正在进行的轮次结束。 */
  protected abstract settle(): Promise<void>;

  async cancel(): Promise<void> {
    if (this.events.closed) return;
    this.cancelled = true;
    const child = this.child;
    if (child !== undefined) await this.context.host.killTree(child, CANCEL_GRACE_MS);
    await this.settle().catch(() => undefined);
    if (this.events.closed) return;
    this.push(this.event('cancelled', { result: this.result() }));
    this.close();
  }

  protected push(event: AgentEvent): void {
    this.events.push(event);
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
