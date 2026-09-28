import type { SaveTokenPrice, TokenPriceProfile } from '@crewstation/contracts';
import { SaveTokenPriceSchema } from '@crewstation/contracts';

export const priceBuckets = ['input', 'cacheRead', 'cacheWrite', 'output'] as const;
export interface TokenPriceDraft {
  provider: string; model: string; condition: string; effectiveFrom: string; sourceNote: string;
  input: string; cacheRead: string; cacheWrite: string; output: string;
}
export function initialTokenPriceDraft(profile: TokenPriceProfile, now: number): TokenPriceDraft {
  const date = new Date(now + 300_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return { provider: '', model: profile.model ?? '', condition: '', effectiveFrom: local, sourceNote: '', input: '', cacheRead: '', cacheWrite: '', output: '' };
}
export function tokenPriceRequest(draft: TokenPriceDraft, profile: TokenPriceProfile, expectedRevision: number, requestKey: string, now: number): { input?: SaveTokenPrice; errors: Readonly<Record<string, string>> } {
  const at = new Date(draft.effectiveFrom);
  const rates = { input: draft.input || null, cacheRead: draft.cacheRead || null, cacheWrite: draft.cacheWrite || null, output: draft.output || null };
  const parsed = SaveTokenPriceSchema.safeParse({
    expectedRevision, requestKey, profileRevision: profile.revision, protocol: profile.protocol,
    provider: draft.provider, model: draft.model, condition: draft.condition || null,
    effectiveFrom: Number.isFinite(at.getTime()) ? at.toISOString() : '', rates, currency: 'CNY', sourceNote: draft.sourceNote,
  });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) errors[String(issue.path.at(-1) ?? '')] = 'admin.pricing.invalid';
  if (!Number.isFinite(at.getTime()) || at.getTime() < now) errors.effectiveFrom = 'admin.pricing.future';
  return Object.keys(errors).length || !parsed.success ? { errors } : { input: parsed.data, errors };
}
