// 两种运行策略（链式 one-shot ／ 常驻流）的公共部分：事件工厂、会话 id 认领、用量快照、终止事件与清理。
// ← agent-workflow `execution/agentProcess.ts` 的 outcome 映射思路，但那里的产物是一条汇总记录，
// 这里的产物是一条 AgentEvent 流。
//
// 用量（RFC-034 v2 §4，与 agent-workflow RFC-371 v2 同一计量规则）：每次执行一个计量器，跨轮累计；
// 快照变化后至多每 USAGE_THROTTLE_MS 发一条 `usage`（整份替换上一份），每轮进程排空后先做一次原生汇总
// 再立即上报，终态事件之前发最终快照，终态事件本身也带上它。

import type { AgentEvent, AgentEventType, AgentUsageSnapshot, KnownAgentProtocol } from '@crewstation/contracts';
import type { DriverAgentProcess, DriverAgentSpec, DriverLaunchContext } from '../contract/agentDriver';
import { DriverStateError } from '../contract/agentDriver';
import type { DriverChildProcess } from '../contract/processHost';
import type { PreparedRuntime } from './cliRuntimeAdapter';
import type { AgentEventFields } from './agentEventMapping';
import { createAgentEventFactory, resultUsageOf } from './agentEventMapping';
import type { EventStream } from './eventStream';
import { createEventStream } from './eventStream';
import { businessUsageOf, hasUsage, sameUsage, type UsageMeter } from './usage/meter';

/** 杀进程树时给 SIGTERM 的宽限；到期升级 SIGKILL（宿主 processTree.ts 实现）。 */
export const CANCEL_GRACE_MS = 5000;
/** 两条中间 usage 事件的最小间隔（RFC-034 v2 §4：≤3 秒一次）。 */
export const USAGE_THROTTLE_MS = 3000;

const NO_USAGE: AgentUsageSnapshot = { state: 'partial', models: [] };

export abstract class AgentRunBase implements DriverAgentProcess {
  readonly events: EventStream<AgentEvent>;
  protected readonly event: ReturnType<typeof createAgentEventFactory>;
  protected readonly startedAt = Date.now();
  protected sessionId: string | undefined;
  protected cancelled = false;
  protected child: DriverChildProcess | undefined;
  private readonly meter: UsageMeter;
  /** 业务 usage 事件的累计范围：一次执行一个，恢复同一 Agent 的下一次执行另起一个。 */
  private readonly usageScope = crypto.randomUUID();
  private usageRevision = 0;
  private reported: AgentUsageSnapshot = NO_USAGE;
  private usageTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUsageAt = 0;
  private inventoryReported = false;

  constructor(
    protected readonly spec: DriverAgentSpec,
    protected readonly context: DriverLaunchContext,
    protected readonly prepared: PreparedRuntime,
    protected readonly protocol: KnownAgentProtocol,
  ) {
    this.events = createEventStream<AgentEvent>(spec.businessEvents ? 4 * 1024 * 1024 : undefined);
    this.event = createAgentEventFactory(spec.agentId);
    this.meter = prepared.usageMeter({ resumed: spec.resumeSessionId !== undefined, startedAt: this.startedAt });
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
    this.terminate('cancelled', {}, null);
  }

  protected push(event: AgentEvent): void {
    if (event.type === 'startup-inventory') {
      if (this.spec.startupInventoryVersion !== 1 || this.inventoryReported) return;
      this.inventoryReported = true;
    }
    this.events.push(event);
  }

  protected emit(type: AgentEventType, fields?: AgentEventFields, at?: number): AgentEvent {
    return this.event(type, fields, at);
  }

  /** 开发 Bot 的已接收输入与回答共用持久事件序列；业务执行沿用原有消息契约。 */
  protected recordInput(text: string): void {
    if (this.spec.mode === 'interactive' && !this.spec.businessEvents) this.push(this.emit('user-message', { text }));
  }

  /** 一条解析成功的 stdout 行交给计量器；快照变化后按节流上报。 */
  protected observeUsage(source: Record<string, unknown>): void {
    if (this.meter.observe(source)) this.scheduleUsage();
  }

  /** 一轮的进程排空之后：先做原生汇总（含子 Agent），再立即上报。 */
  protected settleTurnUsage(): void {
    if (this.spec.startupInventoryVersion === 1 && !this.inventoryReported && this.prepared.startupInventory && !this.cancelled) this.push(this.emit('startup-inventory', { inventory: this.prepared.startupInventory(this.sessionId) }));
    this.meter.refresh?.();
    this.flushUsage();
  }

  /** 快照有变化就同步发一条 usage，因此总排在随后的终态事件之前。 */
  protected flushUsage(): void {
    if (this.usageTimer !== undefined) {
      clearTimeout(this.usageTimer);
      this.usageTimer = undefined;
    }
    if (this.events.closed) return;
    const snapshot = this.meter.snapshot();
    if (!hasUsage(snapshot) || sameUsage(snapshot, this.reported)) return;
    this.reported = snapshot;
    this.lastUsageAt = Date.now();
    this.usageRevision += 1;
    const usage = this.spec.businessEvents ? { usage: businessUsageOf(this.usageScope, snapshot, this.usageRevision) } : {};
    this.push(this.emit('usage', { usageSnapshot: snapshot, ...usage }));
  }

  private scheduleUsage(): void {
    if (this.usageTimer !== undefined || this.events.closed) return;
    const wait = this.lastUsageAt + USAGE_THROTTLE_MS - Date.now();
    if (wait <= 0) {
      this.flushUsage();
      return;
    }
    this.usageTimer = setTimeout(() => {
      this.usageTimer = undefined;
      // 业务事件缓冲已满时 push 会让流以失败结束；这里只记一笔，失败由事件消费方收到。
      try { this.flushUsage(); } catch { this.context.logger.warn('agent usage event dropped'); }
    }, wait);
    this.usageTimer.unref?.();
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

  protected finishCompleted(exitCode: number | null): void {
    this.terminate('completed', {}, exitCode);
  }

  protected finishFailed(code: string, message: string, exitCode: number | null): void {
    this.terminate('error', { error: { code, message } }, exitCode);
  }

  /** 最终快照先作为 usage 发出，终态事件再带上同一份（观测侧据此一次写定终态与用量）。 */
  private terminate(type: 'completed' | 'error' | 'cancelled', fields: AgentEventFields, exitCode: number | null): void {
    if (this.events.closed) return;
    if (this.spec.startupInventoryVersion === 1 && !this.inventoryReported) this.push(this.emit('startup-inventory', { inventory: { version: 1, state: 'unavailable', reason: type === 'cancelled' ? 'inventory-cancelled' : type === 'error' ? 'inventory-start-failed' : 'inventory-not-reported' } }));
    this.flushUsage();
    const snapshot = this.meter.snapshot();
    const usage = resultUsageOf(snapshot);
    this.push(this.emit(type, {
      ...fields,
      result: { ...(exitCode === null ? {} : { exitCode }), ...(usage ? { usage } : {}), durationMs: Date.now() - this.startedAt },
      ...(hasUsage(snapshot) ? { usageSnapshot: snapshot } : {}),
    }));
    this.close();
  }

  protected close(): void {
    if (this.usageTimer !== undefined) clearTimeout(this.usageTimer);
    this.usageTimer = undefined;
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
