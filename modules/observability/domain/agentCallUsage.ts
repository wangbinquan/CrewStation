// RFC-034 v2 §3–§4 —— 一次 Agent 执行的用量是按运行时实际报告的模型拆分、整份替换的快照
// （与 agent-workflow RFC-371 v2 `modules/run-observability/domain/usage.ts` 同一规则）。
// 未知不是 0：空的 partial 只是「还没有报告」，不是证明为零。

import type { AgentCallStatus, AgentUsageSnapshot, AgentUsageState } from '@crewstation/contracts';

export interface UsageBuckets {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** 含推理。 */
  readonly output: number;
  /** 输出中已知的推理部分，不再另行相加。 */
  readonly reasoning: number;
}

export interface ModelUsage extends UsageBuckets {
  /** 运行时实际报告的模型；空串为未归属。 */
  readonly model: string;
}

export interface ObservedUsage {
  readonly state: 'partial' | 'complete';
  readonly models: readonly ModelUsage[];
}

export type EndedStatus = Exclude<AgentCallStatus, 'running'>;

export const ZERO_BUCKETS: UsageBuckets = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };

const count = (value: number): number => (Number.isSafeInteger(value) && value > 0 ? value : 0);

/** 合并重复模型键、丢弃非法计数；推理始终不超过输出。 */
export function normalizeObservedUsage(usage: AgentUsageSnapshot | ObservedUsage): ObservedUsage {
  const byModel = new Map<string, ModelUsage>();
  for (const row of usage.models) {
    const model = row.model.trim().slice(0, 300);
    const previous = byModel.get(model);
    const output = count(row.output) + (previous?.output ?? 0);
    byModel.set(model, {
      model,
      input: count(row.input) + (previous?.input ?? 0),
      cacheRead: count(row.cacheRead) + (previous?.cacheRead ?? 0),
      cacheWrite: count(row.cacheWrite) + (previous?.cacheWrite ?? 0),
      output,
      reasoning: Math.min(output, count(row.reasoning) + (previous?.reasoning ?? 0)),
    });
  }
  return {
    state: usage.state === 'complete' ? 'complete' : 'partial',
    models: [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model)).slice(0, 100),
  };
}

export function sumBuckets(rows: readonly UsageBuckets[]): UsageBuckets {
  return rows.reduce<UsageBuckets>((sum, row) => ({
    input: sum.input + row.input,
    cacheRead: sum.cacheRead + row.cacheRead,
    cacheWrite: sum.cacheWrite + row.cacheWrite,
    output: sum.output + row.output,
    reasoning: sum.reasoning + row.reasoning,
  }), ZERO_BUCKETS);
}

export function totalTokens(row: UsageBuckets): number {
  return row.input + row.cacheRead + row.cacheWrite + row.output;
}

/**
 * 结束执行的最终快照。取消或中断的进程是被外部停下的，可能停在一次请求中途；
 * 运行时只在请求完成后记账，所以已报告的只是下界。
 */
export function finalUsageOf(usage: ObservedUsage, status: EndedStatus): ObservedUsage {
  return usage.state === 'complete' && (status === 'canceled' || status === 'interrupted') ? { ...usage, state: 'partial' } : usage;
}

/** 按最新快照得出落库的用量状态。 */
export function usageStateOf(usage: ObservedUsage | null, ended: boolean): AgentUsageState {
  if (usage?.state === 'complete') return 'complete';
  if (!usage || usage.models.length === 0) return ended ? 'none' : 'pending';
  return 'partial';
}
