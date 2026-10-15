import type { AgentUsageSnapshot, KnownAgentProtocol } from '@crewstation/contracts';
import { createTerminalUsageMeter, hasUsage, sameUsage, type TerminalUsageMeter } from '@crewstation/agent-drivers';

/** 终端用量的采样周期（RFC-034 v2 §4：每 10 秒及退出时）。 */
export const TERMINAL_USAGE_INTERVAL_MS = 10_000;

/**
 * 「＋ CLI」终端的用量上报：活动通道把会话与模型请求交给计量器，这里按周期采样，
 * 快照变化才回调（整份替换）；退出时再采一次作为最终快照。读不到时保留上一份。
 */
export class TerminalUsageReporter {
  readonly meter: TerminalUsageMeter;
  /** 原生存储的位置要等启动前步骤与装配结束后的最终环境：先建计量器，开始采样时再补上。 */
  private readonly env: Record<string, string | undefined> = {};
  private timer: ReturnType<typeof setInterval> | undefined;
  private last: AgentUsageSnapshot | undefined;

  constructor(protocol: KnownAgentProtocol, private readonly report: (usage: AgentUsageSnapshot) => void, startedAt = Date.now()) {
    this.meter = createTerminalUsageMeter(protocol, this.env, startedAt);
  }

  /** CLI 进程拉起后开始周期采样；`finalEnv` 是实际进程环境（定位原生存储）。 */
  start(finalEnv: Readonly<Record<string, string | undefined>>, intervalMs = TERMINAL_USAGE_INTERVAL_MS): void {
    Object.assign(this.env, finalEnv);
    this.timer = setInterval(() => this.sample(), intervalMs);
    this.timer.unref?.();
  }

  /** 采一次；快照变化时上报并返回 true。 */
  sample(): boolean {
    const next = this.meter.read();
    if (!next || !hasUsage(next) || (this.last && sameUsage(next, this.last))) return false;
    this.last = next;
    this.report(next);
    return true;
  }

  /** 停止采样并给出最终快照（没有任何用量时为 undefined）。 */
  finish(): AgentUsageSnapshot | undefined {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const next = this.meter.read();
    if (next && hasUsage(next)) this.last = next;
    return this.last;
  }
}
