import type { ExecutionUsageObservation } from '@crewstation/contracts';
/** RFC-034: four disjoint buckets. Decimal strings preserve large aggregates. */
export const TOKEN_BUCKETS = ['input', 'cacheRead', 'cacheWrite', 'output'] as const
export type TokenBucket = (typeof TOKEN_BUCKETS)[number]
export type TokenUsage = Readonly<Record<TokenBucket, string | null>>

export function tokenCount(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  if (typeof value === 'string' && /^(0|[1-9]\d{0,59})$/.test(value)) return value
  throw new RangeError('Token count must be a nonnegative exact integer or null')
}

export function normalizeTokenUsage(value: Readonly<Record<TokenBucket, unknown>>): TokenUsage {
  return {
    input: tokenCount(value.input),
    cacheRead: tokenCount(value.cacheRead),
    cacheWrite: tokenCount(value.cacheWrite),
    output: tokenCount(value.output),
  }
}

export interface TokenSummary {
  readonly known: Readonly<Record<TokenBucket, string>>
  readonly totalKnown: string
  readonly measured: number
  readonly complete: number
  readonly unknownBuckets: Readonly<Record<TokenBucket, number>>
}

/** Only mutually exclusive ledger contributions belong here, never parent + child. */
export function summarizeTokenUsage(rows: readonly TokenUsage[]): TokenSummary {
  const known = { input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n }
  const unknownBuckets = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let complete = 0
  for (const row of rows) {
    let missing = false
    for (const bucket of TOKEN_BUCKETS) {
      const count = tokenCount(row[bucket])
      if (count === null) {
        unknownBuckets[bucket]++
        missing = true
      } else known[bucket] += BigInt(count)
    }
    if (!missing) complete++
  }
  return {
    known: {
      input: String(known.input), cacheRead: String(known.cacheRead),
      cacheWrite: String(known.cacheWrite), output: String(known.output),
    },
    totalKnown: String(known.input + known.cacheRead + known.cacheWrite + known.output),
    measured: rows.length, complete, unknownBuckets,
  }
}

/** A resume baseline must come from the same native lineage, not another invocation. */
export function subtractTokenBaseline(current: TokenUsage, baseline: TokenUsage): TokenUsage {
  const subtract = (bucket: TokenBucket): string | null => {
    const next = tokenCount(current[bucket]), before = tokenCount(baseline[bucket])
    if (next === null || before === null) return null
    const delta = BigInt(next) - BigInt(before)
    if (delta < 0n) throw new RangeError('Cumulative usage decreased without a correction or reset')
    return String(delta)
  }
  return { input: subtract('input'), cacheRead: subtract('cacheRead'), cacheWrite: subtract('cacheWrite'), output: subtract('output') }
}


class NativeCoverageConflict extends Error {}
type ScopedUsage = ExecutionUsageObservation & { scope: NonNullable<ExecutionUsageObservation['scope']> };
export interface SelectedRuntimeUsage { record: ExecutionUsageObservation; contribution: TokenUsage; whole: boolean }
function coverageRelation(a: ScopedUsage, b: ScopedUsage, bucket: TokenBucket) {
  const x = a.scope, y = b.scope;
  const inside = x.session === y.session || x.level === 'tree-total' && y.ancestors.includes(x.session);
  const contains = y.level === 'tree-total' && x.ancestors.includes(y.session);
  if (!inside && !contains) return 'disjoint';
  const aEnd = a.projection.coveredThrough?.[bucket] ?? a.coveredThroughTurn ?? x.turnIndex;
  const bEnd = b.projection.coveredThrough?.[bucket] ?? b.coveredThroughTurn ?? y.turnIndex;
  if (aEnd < y.turnIndex || bEnd < x.turnIndex) return 'disjoint';
  if (a.modelRef !== null && b.modelRef !== null && a.modelRef !== b.modelRef) return 'disjoint';
  const modelCovered = a.modelRef === null || a.modelRef === b.modelRef;
  return inside && modelCovered && x.turnIndex <= y.turnIndex && aEnd >= bEnd ? 'covered' : 'partial';
}
function selectCoverageGroup(records: ScopedUsage[]) {
  const rank = { 'tree-total': 0, 'self-total': 1, request: 2 };
  const ordered = [...records].sort((a, b) => rank[a.scope.level] - rank[b.scope.level] || a.scope.ancestors.length - b.scope.ancestors.length || a.scope.turnIndex - b.scope.turnIndex || a.recordId.localeCompare(b.recordId));
  const allocated = new Map<ScopedUsage, Record<TokenBucket, string | null>>(), ancestry = new Map<string, string>();
  let incomplete = false;
  for (const { scope } of ordered) {
    const path = [...scope.ancestors, scope.session];
    for (const [i, id] of path.entries()) {
      const expected = JSON.stringify(path.slice(0, i));
      if (ancestry.has(id) && ancestry.get(id) !== expected) throw new NativeCoverageConflict('Conflicting native usage ancestry');
      ancestry.set(id, expected);
    }
  }
  for (const bucket of TOKEN_BUCKETS) {
    const totals: ScopedUsage[] = [];
    for (const record of ordered) {
      const relation = totals.map((a) => coverageRelation(a, record, bucket));
      if (relation.includes('covered')) continue;
      if (relation.includes('partial')) { incomplete = true; continue; }
      const value = record.projection.contribution[bucket], summary = record.scope.level !== 'request';
      if (summary && value === null) incomplete = true;
      const row = allocated.get(record) ?? { input: '0', output: '0', cacheRead: '0', cacheWrite: '0' };
      row[bucket] = value; allocated.set(record, row);
      if (summary && value !== null) totals.push(record);
    }
  }
  return { selected: [...allocated].map(([record, contribution]) => ({ record, contribution, whole: TOKEN_BUCKETS.every((b) => contribution[b] === record.projection.contribution[b]) })), incomplete };
}

/** Parent and child measurements are allocated once, independently for each token bucket. */
export function selectRuntimeUsage(records: ExecutionUsageObservation[]): { selected: SelectedRuntimeUsage[]; incomplete: boolean; conflicts: number } {
  const groups = new Map<string, ScopedUsage[]>(), selected: SelectedRuntimeUsage[] = [];
  let incomplete = false, conflicts = 0;
  for (const record of records) {
    if (!record.scope) { selected.push({ record, contribution: record.projection.contribution, whole: true }); continue; }
    const key = JSON.stringify([record.sourceId, record.identity, record.scope.root]);
    const group = groups.get(key) ?? []; group.push(record as ScopedUsage); groups.set(key, group);
  }
  for (const group of groups.values()) {
    try { const result = selectCoverageGroup(group); selected.push(...result.selected); incomplete ||= result.incomplete; }
    catch (error) { if (!(error instanceof NativeCoverageConflict)) throw error; incomplete = true; conflicts++; }
  }
  return { selected, incomplete, conflicts };
}
