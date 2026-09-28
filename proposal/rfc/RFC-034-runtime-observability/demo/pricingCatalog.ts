import { prices, snapshot } from './fixture';
import type { Usage } from './fixture';

export type PricingKey = keyof typeof prices;
export interface RateVersion { key: PricingKey; version: number; effectiveAt: string; rates: Usage }
export interface RateDraft { input: string; read: string; write: string; output: string; effectiveAt: string }
export const rateFields = [
  { key: 'input', label: '非缓存输入' }, { key: 'read', label: '缓存读取' },
  { key: 'write', label: '缓存写入' }, { key: 'output', label: '输出' },
] as const;
export const pricingProfiles = [
  { key: 'general' as const, name: '通用推理 · r6', runtime: 'OpenCode', model: prices.general.label, provider: '示例模型服务 G' },
  { key: 'code' as const, name: '代码分析 · r3', runtime: 'Claude Code', model: prices.code.label, provider: '示例模型服务 C' },
];
export const initialRateVersions: RateVersion[] = pricingProfiles.map((p) => ({
  key: p.key, version: 1, effectiveAt: '2026-09-01T00:00', rates: { ...prices[p.key] },
}));
export function nextRateDraft(key: PricingKey, versions: RateVersion[]): RateDraft {
  const latest = versions.filter((v) => v.key === key).at(-1)!;
  return { input: String(latest.rates.input), read: String(latest.rates.read), write: String(latest.rates.write), output: String(latest.rates.output), effectiveAt: '2026-09-29T00:00' };
}
export function rateDraftError(draft: RateDraft, key: PricingKey, versions: RateVersion[]): string | null {
  if (rateFields.some(({ key: field }) => !/^\d+(\.\d{1,6})?$/.test(draft[field]) || Number(draft[field]) > 1000000)) return '四项单价均需填写非负数字，最多 6 位小数，且不超过 1,000,000 元。0 表示明确免费，留空不代表免费。';
  const effective = Date.parse(draft.effectiveAt + ':00+08:00');
  const latest = Math.max(Date.parse(snapshot), ...versions.filter((v) => v.key === key).map((v) => Date.parse(v.effectiveAt + ':00+08:00')));
  return !Number.isFinite(effective) || effective <= latest ? '生效时间须晚于演示快照 2026-09-28 16:00 及该档位最近的价格版本，时区 UTC+08:00。' : null;
}
export function draftVersion(key: PricingKey, draft: RateDraft, versions: RateVersion[]): RateVersion {
  return { key, version: Math.max(...versions.filter((v) => v.key === key).map((v) => v.version)) + 1, effectiveAt: draft.effectiveAt,
    rates: { input: Number(draft.input), read: Number(draft.read), write: Number(draft.write), output: Number(draft.output) } };
}
