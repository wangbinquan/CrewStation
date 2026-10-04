import {compareCompleteUsage,completeUsageGroup as groupOf} from '../domain/completeUsageOrder';
import type { UsageContributionEvidence } from '../domain/completeUsageEvidence'
import { TOKEN_BUCKETS, tokenCount, type TokenBucket, type TokenUsage } from '../domain/tokenUsage'
import { coveragePrefixMaximum, insertCoverageInterval, type CoverageIntervalStore } from '../domain/coverageIntervalIndex'
import type { CompleteUsageWorkspace } from '../ports/completeUsageWorkspace'

const modelPartition = (id: string, provider: string | null) =>
  JSON.stringify(['model', id, provider])
const modelAnyProvider = (id: string) => JSON.stringify(['model', id])
const treeKey = (
  group: string,
  bucket: TokenBucket,
  session: string,
  treeOnly: boolean,
  model: string,
) => JSON.stringify([group, bucket, session, treeOnly, model])
const endOf = (record: UsageContributionEvidence, bucket: TokenBucket) =>
  record.coveredThrough?.[bucket] ??
  record.measurement.coveredThroughTurn ??
  record.measurement.scope!.turnIndex

async function coverageRelation(store: CoverageIntervalStore, record: UsageContributionEvidence, bucket: TokenBucket) {
  const scope = record.measurement.scope!, model = record.measurement.model, group = groupOf(record), end = endOf(record, bucket);
  const sessions = [{ id: scope.session, treeOnly: false }, ...scope.ancestors.map((id) => ({ id, treeOnly: true }))];
  const coverModels = ['null', ...(model === null ? [] : [modelPartition(model.id, model.provider)])];
  const overlapModels = model === null ? ['all'] : ['null', model.provider === null ? modelAnyProvider(model.id) : modelPartition(model.id, model.provider), ...(model.provider === null ? [] : [modelPartition(model.id, null)])];
  let covered = false, overlapping = false;
  for (const session of sessions) {
    for (const partition of coverModels) {
      const maximum = await coveragePrefixMaximum(store, treeKey(group, bucket, session.id, session.treeOnly, partition), Math.min(scope.turnIndex, end));
      if (maximum !== null && maximum >= Math.max(scope.turnIndex, end)) covered = true;
    }
    if (!covered) for (const partition of overlapModels) {
      const maximum = await coveragePrefixMaximum(store, treeKey(group, bucket, session.id, session.treeOnly, partition), end);
      if (maximum !== null && maximum >= scope.turnIndex) overlapping = true;
    }
  }
  return { covered, overlapping };
}
async function rememberSummary(store: CoverageIntervalStore, record: UsageContributionEvidence, bucket: TokenBucket) {
  const scope = record.measurement.scope!, model = record.measurement.model;
  const partitions = model === null ? ['all', 'null'] : ['all', modelAnyProvider(model.id), modelPartition(model.id, model.provider)];
  for (const treeOnly of scope.level === 'tree-total' ? [false, true] : [false]) for (const partition of partitions)
    await insertCoverageInterval(store, treeKey(groupOf(record), bucket, scope.session, treeOnly, partition), { start: scope.turnIndex, end: endOf(record, bucket) });
}
async function bucketSelection(store: CoverageIntervalStore, record: UsageContributionEvidence, bucket: TokenBucket) {
  const scope = record.measurement.scope;
  if (!scope) return { excluded: false, ambiguous: false, unavailable: false };
  const relation = await coverageRelation(store, record, bucket);
  if (relation.covered) return { excluded: true, ambiguous: false, unavailable: false };
  if (relation.overlapping) return { excluded: true, ambiguous: true, unavailable: false };
  const summary = scope.level !== 'request', value = record.contribution[bucket];
  if (summary && value !== null) await rememberSummary(store, record, bucket);
  return { excluded: false, ambiguous: false, unavailable: summary && value === null };
}

/** Exact four-bucket selection using persistent prefix maxima; never an all-summary scan. */
export async function selectCompleteUsage<T extends UsageContributionEvidence>(
  workspace: CompleteUsageWorkspace<T>,
  signal?: AbortSignal,
  issue?: (record:T,quality:{ambiguous:boolean;unavailable:boolean},allocated:boolean)=>Promise<void>,
) {
  for await (const record of workspace.records()) {
    signal?.throwIfAborted()
    const scope = record.measurement.scope
    if (!scope) continue
    const path = [...scope.ancestors, scope.session]
    if (new Set(path).size !== path.length) throw new Error('Cyclic observation session ancestry')
    if (path[0] !== scope.root || (scope.ancestors.at(-1) ?? null) !== scope.parentSession)
      throw new Error('Incomplete observation session ancestry')
    for (let i = 0; i < path.length; i++)
      await workspace.bindAncestry(groupOf(record), path[i]!, path.slice(0, i))
  }
  const totals = { input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n }
  const unknown = { input: 0n, cacheRead: 0n, cacheWrite: 0n, output: 0n }
  let selected = 0n,
    excluded = 0n,
    ambiguousOverlaps = 0n,
    unavailableSummaries = 0n
  let allSelectedComplete = true
  let previous: T | undefined
  for await (const record of workspace.orderedRecords()) {
    signal?.throwIfAborted()
    if (previous && compareCompleteUsage(previous, record) > 0)
      throw new Error('Complete usage merge order invalid')
    previous = record
    const allocation: Record<TokenBucket, string | null> = {
      input: '0',
      cacheRead: '0',
      cacheWrite: '0',
      output: '0',
    }
    let allocated = false,
      ambiguous = false,
      unavailable = false
    for (const bucket of TOKEN_BUCKETS) {
      const value = record.contribution[bucket]
      const decision = await bucketSelection(workspace.coverage, record, bucket)
      ambiguous ||= decision.ambiguous
      unavailable ||= decision.unavailable
      if (decision.excluded) continue
      const count = tokenCount(value)
      allocation[bucket] = count
      allocated = true
      if (count === null) unknown[bucket]++
      else totals[bucket] += BigInt(count)
    }
    if (ambiguous) ambiguousOverlaps++
    if (unavailable) unavailableSummaries++
    if(ambiguous||unavailable)await issue?.(record,{ambiguous,unavailable},allocated)
    if (allocated) {
      selected++
      allSelectedComplete &&= record.complete
      await workspace.allocate(record, allocation satisfies TokenUsage, { ambiguous, unavailable })
    } else excluded++
  }
  return {
    selected: selected.toString(),
    excluded: excluded.toString(),
    ambiguousOverlaps: ambiguousOverlaps.toString(),
    unavailableSummaries: unavailableSummaries.toString(),
    tokens: Object.fromEntries(TOKEN_BUCKETS.map((bucket) => [bucket, totals[bucket].toString()])),
    unknownBuckets: Object.fromEntries(
      TOKEN_BUCKETS.map((bucket) => [bucket, unknown[bucket].toString()]),
    ),
    allSelectedComplete:
      selected > 0n &&
      allSelectedComplete &&
      ambiguousOverlaps === 0n &&
      unavailableSummaries === 0n &&
      TOKEN_BUCKETS.every((bucket) => unknown[bucket] === 0n),
  }
}
