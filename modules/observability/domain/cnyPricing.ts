import type { ExecutionObservation, ExecutionUsageObservation, RuntimeUsageMetrics } from '@crewstation/contracts';
import { TOKEN_BUCKETS, tokenCount, summarizeTokenUsage, selectRuntimeUsage, type TokenBucket, type TokenUsage } from './tokenUsage'

/** Yuan per million tokens, up to six decimal places; null means unpriced. */
export type CnyRates = Readonly<Record<TokenBucket, string | null>>
const PICO_YUAN = 1_000_000_000_000n

export function rateMicros(value: string | null): bigint | null {
  if (value === null) return null
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value)) {
    throw new RangeError('CNY rate must be a nonnegative decimal with at most six places')
  }
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

function decimalAtScale(value: bigint, places: number): string {
  const scale = 10n ** BigInt(places)
  const fraction = (value % scale).toString().padStart(places, '0').replace(/0+$/, '')
  return `${value / scale}${fraction ? `.${fraction}` : ''}`
}

export interface CnyValuation {
  readonly currency: 'CNY'
  /** Exact subtotal in yuan. Not rounded until presentation. */
  readonly knownAmount: string
  readonly completeness: 'complete' | 'partial' | 'unpriced'
  readonly missing: readonly TokenBucket[]
}

export function valueTokenUsage(usage: TokenUsage, rates: CnyRates): CnyValuation {
  let amount = 0n, priced = 0
  const missing: TokenBucket[] = []
  for (const bucket of TOKEN_BUCKETS) {
    const count = tokenCount(usage[bucket]), rate = rateMicros(rates[bucket])
    if (count === null || (rate === null && count !== '0')) missing.push(bucket)
    else {
      amount += BigInt(count) * (rate ?? 0n)
      priced++
    }
  }
  return { currency: 'CNY', knownAmount: decimalAtScale(amount, 12), completeness: missing.length === 0 ? 'complete' : priced === 0 ? 'unpriced' : 'partial', missing }
}

export function cnyPicos(amount: string): bigint {
  if (!/^(0|[1-9]\d{0,79})(\.\d{1,12})?$/.test(amount)) throw new RangeError('Invalid exact CNY amount')
  const [whole = '0', fraction = ''] = amount.split('.')
  return BigInt(whole) * PICO_YUAN + BigInt(fraction.padEnd(12, '0'))
}

export function sumCnyAmounts(amounts: readonly string[]): string {
  return decimalAtScale(amounts.reduce((total, amount) => total + cnyPicos(amount), 0n), 12)
}

export function formatCnyAmount(amount: string): string {
  const picos = cnyPicos(amount)
  if (picos > 0n && picos < 1_000_000n) return '<¥0.000001'
  return `¥${decimalAtScale((picos + 500_000n) / 1_000_000n, 6)}`
}


const observationKey = (row: ExecutionObservation) => JSON.stringify([row.identity, row.sourceId, row.recordId]);
/** A valuation belongs to one whole canonical record at exactly its current projection revision. */
export function runtimeUsageMetrics(observations: ExecutionObservation[], visible: boolean, expected: number, partial = false): RuntimeUsageMetrics {
  const usage = observations.filter((r): r is ExecutionUsageObservation => r.kind === 'usage');
  const selection = selectRuntimeUsage(usage), selected = selection.selected;
  const values = new Map(observations.flatMap((r) => r.kind === 'valuation' ? [[observationKey(r), r] as const] : []));
  const tokens = summarizeTokenUsage(selected.map((r) => r.contribution)), amounts: string[] = [], reasons = new Set<string>();
  let priced = 0;
  for (const { record, whole } of selected) {
    for (const issue of record.projection.issues) reasons.add(issue);
    if (!record.projection.complete) reasons.add('usage-partial');
    const value = values.get(observationKey(record));
    if (!whole) reasons.add('valuation-overlap');
    else if (!value || value.usageRevision !== record.projection.projectionRevision) reasons.add('valuation-pending');
    else if (value.availability !== 'priced') reasons.add(value.availability);
    else { amounts.push(value.amountDecimal); if (value.completeness === 'complete') priced++; else reasons.add('valuation-partial'); }
  }
  const observed = new Set(usage.map((r) => JSON.stringify([r.identity.executionId, r.identity.executionGeneration]))).size;
  const missing = Math.max(0, expected - observed);
  if (missing) reasons.add('usage-missing');
  if (selection.incomplete) reasons.add('coverage-overlap');
  if (selection.conflicts) reasons.add('coverage-conflict');
  if (partial) reasons.add('truncated');
  if (!expected) reasons.add('not-applicable');
  const unknownBuckets = { ...tokens.unknownBuckets };
  for (const bucket of TOKEN_BUCKETS) unknownBuckets[bucket] += missing + selection.conflicts;
  return { tokens: { ...tokens.known, total: tokens.totalKnown, unknownBuckets,
    hasKnown: selected.some((r) => TOKEN_BUCKETS.some((b) => r.contribution[b] !== null)),
    complete: expected > 0 && !missing && !partial && !selection.incomplete && tokens.complete === selected.length && selected.length > 0 && selected.every((r) => r.record.projection.complete) },
    cost: { currency: 'CNY', visible, amount: visible && amounts.length ? sumCnyAmounts(amounts) : null,
      complete: visible && expected > 0 && !missing && !partial && !selection.incomplete && priced === selected.length && selected.length > 0 },
    executions: expected, observedExecutions: observed, records: selected.length, reasons: [...reasons], partial };
}

export function aggregateRuntimeMetrics(rows: RuntimeUsageMetrics[], partial = false, visible = true): RuntimeUsageMetrics {
  const active = rows.filter((r) => r.executions > 0), sum = (get: (r: RuntimeUsageMetrics) => number) => rows.reduce((n, r) => n + get(r), 0);
  const tokens = { input: '0', cacheRead: '0', cacheWrite: '0', output: '0' }, unknownBuckets = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  for (const bucket of TOKEN_BUCKETS) { tokens[bucket] = rows.reduce((n, r) => n + BigInt(r.tokens[bucket]), 0n).toString(); unknownBuckets[bucket] = sum((r) => r.tokens.unknownBuckets[bucket]); }
  partial ||= rows.some((r) => r.partial); visible &&= rows.every((r) => r.cost.visible);
  const amounts = rows.flatMap((r) => r.cost.amount === null ? [] : [r.cost.amount]);
  return { tokens: { ...tokens, unknownBuckets, total: TOKEN_BUCKETS.reduce((n, b) => n + BigInt(tokens[b]), 0n).toString(), hasKnown: rows.some((r) => r.tokens.hasKnown), complete: active.length > 0 && !partial && active.every((r) => r.tokens.complete) },
    cost: { currency: 'CNY', visible, amount: visible && amounts.length ? sumCnyAmounts(amounts) : null, complete: visible && active.length > 0 && !partial && active.every((r) => r.cost.complete) },
    executions: sum((r) => r.executions), observedExecutions: sum((r) => r.observedExecutions), records: sum((r) => r.records),
    reasons: [...new Set([...rows.flatMap((r) => r.reasons), ...(partial ? ['truncated'] : [])])], partial };
}
