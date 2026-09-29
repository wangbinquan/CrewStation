import { ExecutionObservationIdentitySchema, ExecutionValuationObservationSchema, type ExecutionValuationObservation, type TokenPriceVersion, type RunnerUsageSourcePage } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, validation, type Clock } from '@crewstation/kernel';
import { z } from 'zod';
import { valueTokenUsage } from '../domain/cnyPricing';
import type { ExecutionPriceStore } from '../ports/tokenPricing';
import type { ExecutionValuationRequest, ExecutionValuationStore, RunnerUsageSource, UsageSourcePage } from '../ports/usageLedger';

const key = z.string().min(1).max(512);
const request = z.strictObject({
  measurement: z.strictObject({ identity: ExecutionObservationIdentitySchema, sourceId: key, recordId: key }),
  usageRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), requestKey: z.string().min(8).max(128),
  model: z.strictObject({ provider: z.string().min(1).max(200), model: z.string().min(1).max(300), condition: z.string().min(1).max(200).nullable() }).nullable(),
});
function amount(price: TokenPriceVersion | undefined, usage: NonNullable<Awaited<ReturnType<ExecutionValuationStore['usage']>>>) {
  if (!price) return { availability: 'unpriced' as const, priceVersionRef: null, amountDecimal: null, completeness: 'unknown' as const };
  const value = valueTokenUsage(usage.projection.contribution, price.rates);
  if (value.completeness === 'unpriced') return { availability: 'unpriced' as const, priceVersionRef: null, amountDecimal: null, completeness: 'unknown' as const };
  return { availability: 'priced' as const, priceVersionRef: price.id, amountDecimal: value.knownAmount,
    completeness: value.completeness === 'complete' && usage.projection.complete ? 'complete' as const : 'partial' as const };
}

/** Independent valuation projection: retries never write or add token usage. */
export function executionValuations(deps: { store: ExecutionValuationStore; pricing: ExecutionPriceStore; clock: Clock }) {
  return async (raw: ExecutionValuationRequest): Promise<ExecutionValuationObservation> => {
    const parsed = request.safeParse(raw);
    if (!parsed.success) throw validation('估值证据无效');
    const input = parsed.data, fingerprint = jsonHash(input);
    const receipt = await deps.store.receipt(input.measurement.identity, input.requestKey);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw conflict('估值请求标识对应不同证据');
      return receipt.document;
    }
    const usage = await deps.store.usage(input.measurement);
    if (!usage) throw notFound('尚无已提交的用量投影');
    if (usage.projection.projectionRevision !== input.usageRevision) throw conflict('用量投影已更新，请基于当前修订重新估值');
    // Price lookup finishes before the ledger transaction, including with a one-connection pool.
    const price = await deps.pricing.price(input.measurement.identity, input.model);
    const basisFingerprint = jsonHash({ usageRevision: input.usageRevision, model: input.model, priceVersion: price?.id ?? null });
    const draft = ExecutionValuationObservationSchema.parse({ ...input.measurement, kind: 'valuation',
      valuationId: jsonHash(input.measurement), revision: 1, valuationRevision: 1, usageRevision: input.usageRevision,
      occurredAt: usage.occurredAt, observedAt: deps.clock.now().toISOString(), currency: 'CNY', ...amount(price, usage) });
    return deps.store.commit(input, fingerprint, basisFingerprint, draft);
  };
}

/** Value the selected model evidence, retaining it when a newer native sample was rejected. */
export function valueRunnerUsagePage(deps: { store: ExecutionValuationStore; source: RunnerUsageSource; value: ReturnType<typeof executionValuations> }) {
  return async (sourcePage: RunnerUsageSourcePage, page: UsageSourcePage) => {
    const refs = new Map(page.events.map(({ measurement }) => [measurement.recordId, { identity: measurement.identity, sourceId: measurement.sourceId, recordId: measurement.recordId }]));
    for (const ref of refs.values()) {
      const current = await deps.store.usage(ref);
      if (!current) throw notFound('已提交用量投影尚不可读取');
      const evidence = await deps.source.measurement(sourcePage, ref.recordId, current.projection.modelRevision ?? current.revision);
      if (!evidence) throw notFound('已提交用量缺少对应原生模型证据');
      const actual = evidence.actualModel;
      const model = actual?.provider && actual.model && jsonHash(actual) === current.modelRef ? { provider: actual.provider, model: actual.model, condition: actual.condition } : null;
      const input = { measurement: ref, usageRevision: current.projection.projectionRevision, model };
      await deps.value({ ...input, requestKey: jsonHash(input) });
    }
    // Repair owners may belong to older sources absent from this Runner page.
    const pending = await deps.store.pendingNativeRepairs(page, 200);
    for (const { usage, modelEvidence } of pending) {
      const actual = modelEvidence?.actualModel ?? null;
      if (usage.modelRef !== null && (!actual || jsonHash(actual) !== usage.modelRef)) throw notFound('历史修订尚无对应的已选模型证据');
      const model = usage.modelRef !== null && actual?.provider && actual.model ? { provider: actual.provider, model: actual.model, condition: actual.condition } : null;
      const input = { measurement: { identity: usage.identity, sourceId: usage.sourceId, recordId: usage.recordId }, usageRevision: usage.projection.projectionRevision, model };
      await deps.value({ ...input, requestKey: jsonHash(input) });
    }
    if ((await deps.store.pendingNativeRepairs(page, 1)).length) throw conflict('历史修订估值继续处理中');
  };
}
