// RFC-034 v2 §3.3 —— 只追加的人民币价格线与整数计价（与 agent-workflow RFC-371 v2
// `modules/run-observability/domain/pricing.ts` 同一规则）。
//
// 一次执行采用其（档位, 模型）价格线里 effectiveFrom 与 createdAt 都不晚于执行开始、且
// (effectiveFrom, createdAt) 最大的版本。版本不可变，所以执行的价格不会再变：新价只影响之后受理的执行，
// 即使生效时间往前填也不改历史。

import type { AgentCostState } from '@crewstation/contracts';
import type { UsageBuckets } from './agentCallUsage';

export interface PriceVersion {
  readonly id: string;
  /** 算力档位 ID；没有档位的执行为 `builtin:<protocol>`。 */
  readonly profileId: string;
  readonly model: string;
  /** 人民币微元 / 百万 Token；null 为未知（不是免费）。 */
  readonly inputMicro: number | null;
  readonly cacheReadMicro: number | null;
  readonly cacheWriteMicro: number | null;
  readonly outputMicro: number | null;
  readonly effectiveFrom: number;
  readonly createdAt: number;
  readonly createdBy: string;
  readonly note: string;
}

export function selectPrice(versions: readonly PriceVersion[], startedAt: number): PriceVersion | null {
  let best: PriceVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom > startedAt || version.createdAt > startedAt) continue;
    if (!best || version.effectiveFrom > best.effectiveFrom
      || (version.effectiveFrom === best.effectiveFrom && version.createdAt > best.createdAt)
      || (version.effectiveFrom === best.effectiveFrom && version.createdAt === best.createdAt && version.id > best.id)) best = version;
  }
  return best;
}

export interface ModelCost {
  /** 已定价各桶的纳元合计；一桶都定不了价时为 null。 */
  readonly costNano: bigint | null;
  /** 每个有 Token 的桶都有已知单价。 */
  readonly complete: boolean;
}

/** Token × 微元/百万 ÷ 1000 = 纳元，四舍五入，BigInt 精确。 */
export function modelCost(usage: UsageBuckets, price: PriceVersion | null): ModelCost {
  if (!price) return { costNano: null, complete: false };
  const buckets: ReadonlyArray<readonly [number, number | null]> = [
    [usage.input, price.inputMicro], [usage.cacheRead, price.cacheReadMicro],
    [usage.cacheWrite, price.cacheWriteMicro], [usage.output, price.outputMicro],
  ];
  let product = 0n, priced = false, complete = true;
  for (const [tokens, rate] of buckets) {
    if (tokens <= 0) continue;
    if (rate === null) { complete = false; continue; }
    product += BigInt(tokens) * BigInt(rate);
    priced = true;
  }
  if (!priced && !complete) return { costNano: null, complete: false };
  return { costNano: (product + 500n) / 1000n, complete };
}

export function callCostState(rows: readonly { readonly tokens: number; readonly cost: ModelCost }[]): { readonly costNano: bigint; readonly costState: AgentCostState } {
  const relevant = rows.filter((row) => row.tokens > 0);
  const costNano = relevant.reduce((sum, row) => sum + (row.cost.costNano ?? 0n), 0n);
  if (relevant.length === 0) return { costNano: 0n, costState: 'none' };
  if (relevant.every((row) => row.cost.complete)) return { costNano, costState: 'priced' };
  if (relevant.every((row) => row.cost.costNano === null)) return { costNano: 0n, costState: 'unpriced' };
  return { costNano, costState: 'partial' };
}
