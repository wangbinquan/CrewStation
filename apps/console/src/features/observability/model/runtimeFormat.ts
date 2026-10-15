import type { AgentCallStatus, ObservationCall, ObservationUsage } from '@crewstation/contracts';
import { formatObservationCny } from '@crewstation/contracts';
import type { BadgeTone } from '../../../shared/ui/Badge';
import type { Translate } from '../../../shared/lib/useT';

// RFC-034 v2 口径（与 agent-workflow RFC-371 v2 相同）：四桶互斥、推理是输出的子集；未知不是 0——
// 用量不完整的执行让合计成为已知下界（「≥」），没有快照的执行显示「—」，未定价不显示为 ¥0。

export const TOKEN_BUCKETS = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;
export type TokenBucket = (typeof TOKEN_BUCKETS)[number];
export type TokenBuckets = Readonly<Record<TokenBucket, number>>;

export const tokenTotal = (usage: TokenBuckets): number => usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
export const countText = (value: number): string => value.toLocaleString('en-US');
export const tokenText = (value: number, lowerBound: boolean): string => `${lowerBound ? '≥ ' : ''}${countText(value)}`;

/** 柱顶的短数字：1.2K / 3.4M。 */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  const [unit, size] = value >= 1e9 ? ['B', 1e9] : value >= 1e6 ? ['M', 1e6] : ['K', 1e3];
  return `${(value / size).toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit}`;
}

/** 汇总的人民币：不可见为「—」；只有未定价的执行时为「未定价」；含未定价或用量不完整的执行时为下界。 */
export function usageCostText(usage: Pick<ObservationUsage, 'incompleteCalls' | 'unpricedCalls' | 'costNano'>, t: Translate): string {
  if (usage.costNano === null) return '—';
  if (usage.unpricedCalls > 0 && BigInt(usage.costNano) === 0n) return t('runtime.unpriced');
  return `${usage.unpricedCalls > 0 || usage.incompleteCalls > 0 ? '≥ ' : ''}${formatObservationCny(usage.costNano)}`;
}

type CallUsage = Pick<ObservationCall, 'usageState' | 'costState' | 'costNano'>;
/** 一次执行的 Token：还没有快照或运行时没有上报为「—」，部分为下界。 */
export function callTokenText(call: CallUsage, value: number): string {
  return call.usageState === 'none' || call.usageState === 'pending' ? '—' : tokenText(value, call.usageState === 'partial');
}
export function callCostText(call: CallUsage, costVisible: boolean, t: Translate): string {
  if (!costVisible || call.costNano === null || call.usageState === 'none' || call.usageState === 'pending') return '—';
  if (call.costState === 'unpriced') return t('runtime.unpriced');
  return `${call.costState === 'partial' || call.usageState === 'partial' ? '≥ ' : ''}${formatObservationCny(call.costNano)}`;
}
/** 按模型拆分的一行：费用不可见为「—」，没有价格为「未定价」。 */
export function modelCostText(costNano: string | null, costVisible: boolean, t: Translate): string {
  if (!costVisible) return '—';
  return costNano === null ? t('runtime.unpriced') : formatObservationCny(costNano);
}

export const STATUS_TONE: Readonly<Record<AgentCallStatus, BadgeTone>> = { running: 'info', done: 'success', failed: 'danger', canceled: 'neutral', interrupted: 'warning' };

export function callDurationMs(call: Pick<ObservationCall, 'startedAt' | 'endedAt'>, asOf: string): number {
  return Math.max(0, Date.parse(call.endedAt ?? asOf) - Date.parse(call.startedAt));
}
export function durationText(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
}
/** 资源与健康页签沿用的时间格式。 */
export function runtimeDate(at: string | null, zone?: string): string {
  if (at === null) return '—';
  return new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', ...(zone ? { timeZone: zone } : {}) }).format(new Date(at));
}
