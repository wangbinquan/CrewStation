import type { ObservationPrice, ObservationPricingProfile, SaveObservationPrice } from '@crewstation/contracts';
import { SaveObservationPriceSchema } from '@crewstation/contracts';

// RFC-034 v2 §3.3：价格线 = 算力档位 × 实际模型；每次保存追加一个版本（以 expectedLatestId 比较并设置）。
// 执行按开始时生效且开始前已创建的版本计价，所以生效时间可以回填，但已开始的执行不会改价。

export const priceBuckets = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;
/** 一条价格线：`model` 为 null 时是给这个档位新增一个模型的价格。 */
export interface PriceLineTarget { readonly profile: ObservationPricingProfile; readonly model: string | null; readonly current: ObservationPrice | null }
export interface TokenPriceDraft {
  model: string; effectiveFrom: string; note: string;
  input: string; cacheRead: string; cacheWrite: string; output: string;
}

const localInput = (at: number) => new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** 以当前版本为底稿（新增模型从空白开始），生效时间缺省为现在。 */
export function initialTokenPriceDraft(model: string, current: ObservationPrice | null, now: number): TokenPriceDraft {
  return {
    model, effectiveFrom: localInput(now), note: '',
    input: current?.rates.input ?? '', cacheRead: current?.rates.cacheRead ?? '', cacheWrite: current?.rates.cacheWrite ?? '', output: current?.rates.output ?? '',
  };
}

/** 留空的单价是未知（不是免费），0 才是明确免费。 */
export function tokenPriceRequest(draft: TokenPriceDraft, expectedLatestId: string | null): { input?: SaveObservationPrice; errors: Readonly<Record<string, string>> } {
  const at = new Date(draft.effectiveFrom);
  const rate = (value: string) => (value.trim() === '' ? null : value.trim());
  const parsed = SaveObservationPriceSchema.safeParse({
    model: draft.model, effectiveFrom: Number.isFinite(at.getTime()) ? at.toISOString() : '', note: draft.note, expectedLatestId,
    rates: { input: rate(draft.input), cacheRead: rate(draft.cacheRead), cacheWrite: rate(draft.cacheWrite), output: rate(draft.output) },
  });
  if (parsed.success) return { input: parsed.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) errors[String(issue.path.at(-1) ?? '')] = 'admin.pricing.invalid';
  return { errors };
}
