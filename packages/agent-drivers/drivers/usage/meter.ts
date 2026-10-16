// RFC-034 v2 §4 —— 与 agent-workflow RFC-371 v2 同一套计量规则（那边的
// `modules/runtime-management/domain/usageMeter.ts`）：每个驱动把自己的 stdout 协议解析成
// 一份「本次执行到目前为止」的按模型快照，整份替换上一份；调用方不按协议名分支。

import type { AgentUsageModel, AgentUsageSnapshot, BusinessUsage } from '@crewstation/contracts';

export interface UsageMeterInput {
  readonly modelAliases?: Readonly<Record<string, string>>;
  /** 本次执行恢复一个已有原生会话。 */
  readonly resumed: boolean;
  /** 档位修订配置的模型（可能为空：交给二进制默认）。 */
  readonly configuredModel: string | null;
  /** 执行开始（ms epoch）：原生存储只统计不早于它的步骤。 */
  readonly startedAt: number;
  /** 子进程的最终环境，只用来定位原生存储，不记录。 */
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface UsageMeter {
  /** 喂一条解析后的 stdout 事件；快照变化时返回 true。 */
  observe(event: Readonly<Record<string, unknown>>): boolean;
  snapshot(): AgentUsageSnapshot;
  /**
   * 一轮的进程排空之后：读一次原生存储得到含子 Agent 的权威汇总并替换内存视图；
   * 读不到返回 false，保留流上的视图。从不抛错。
   */
  refresh?(): boolean;
}

export type JsonObject = Record<string, unknown>;

export const objectOf = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;

/** 报告的 Token 数；缺失、负数或超出安全整数都不计入。 */
export const tokenCount = (value: unknown): number => {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0;
};

export function modelKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 300) : '';
}

type Buckets = Omit<AgentUsageModel, 'model'>;

/** 按模型累加；推理始终不超过输出。 */
export class UsageAccumulator {
  private readonly rows = new Map<string, AgentUsageModel>();

  add(model: string, delta: Buckets): void {
    const previous = this.rows.get(model);
    const output = (previous?.output ?? 0) + delta.output;
    this.rows.set(model, {
      model,
      input: (previous?.input ?? 0) + delta.input,
      cacheRead: (previous?.cacheRead ?? 0) + delta.cacheRead,
      cacheWrite: (previous?.cacheWrite ?? 0) + delta.cacheWrite,
      output,
      reasoning: Math.min(output, (previous?.reasoning ?? 0) + delta.reasoning),
    });
  }

  addAll(rows: readonly AgentUsageModel[]): void {
    for (const row of rows) this.add(row.model, row);
  }

  clear(): void {
    this.rows.clear();
  }

  get empty(): boolean {
    return this.rows.size === 0;
  }

  models(): AgentUsageModel[] {
    return [...this.rows.values()].sort((a, b) => a.model.localeCompare(b.model)).slice(0, 100);
  }

  snapshot(state: AgentUsageSnapshot['state']): AgentUsageSnapshot {
    return { state, models: this.models() };
  }
}

/** 两份快照按模型相加（基线 + 其后新增）。 */
export function combineUsage(base: readonly AgentUsageModel[], later: readonly AgentUsageModel[], state: AgentUsageSnapshot['state']): AgentUsageSnapshot {
  const total = new UsageAccumulator();
  total.addAll(base);
  total.addAll(later);
  return total.snapshot(state);
}

/** 快照是否有任何已知用量（空的 partial 只是「还没有报告」，不是零）。 */
export const hasUsage = (snapshot: AgentUsageSnapshot): boolean => snapshot.models.length > 0;

export function sameUsage(left: AgentUsageSnapshot, right: AgentUsageSnapshot): boolean {
  return left.state === right.state && JSON.stringify(left.models) === JSON.stringify(right.models);
}

/**
 * 发给业务应用的 `usage` 事件：一次执行一个累计范围（scope = 执行 ID），
 * 四个总量为各模型合计，`snapshot` 携带按模型明细（托管 agent-workflow 直接据此记账）。
 */
export function businessUsageOf(scope: string, snapshot: AgentUsageSnapshot, revision: number): BusinessUsage {
  const sum = (key: keyof Buckets) => snapshot.models.reduce((total, row) => total + row[key], 0);
  return {
    measurementId: `${scope}:${revision}`.slice(0, 256),
    scope: scope.slice(0, 256),
    mode: 'cumulative',
    inputTokens: sum('input'),
    outputTokens: sum('output'),
    cacheReadTokens: sum('cacheRead'),
    cacheWriteTokens: sum('cacheWrite'),
    complete: snapshot.state === 'complete',
    snapshot,
  };
}
