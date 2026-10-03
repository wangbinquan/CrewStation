import type { UsageContributionEvidence } from './completeUsageEvidence';

const rank = { 'tree-total': 0, 'self-total': 1, request: 2 }
export const completeUsageGroup = (record: UsageContributionEvidence) =>
  JSON.stringify([
    record.sourceId,
    record.measurement.invocationId,
    record.measurement.scope?.root ?? null,
  ])
/** Used by the external sort and checked again while consuming its final merge. */
export function compareCompleteUsage(a: UsageContributionEvidence, b: UsageContributionEvidence) {
  const grouped = completeUsageGroup(a).localeCompare(completeUsageGroup(b))
  if (grouped) return grouped
  const x = a.measurement.scope,
    y = b.measurement.scope
  if (!x || !y)
    return (
      Number(Boolean(x)) - Number(Boolean(y)) ||
      a.measurement.recordId.localeCompare(b.measurement.recordId)
    )
  return (
    rank[x.level] - rank[y.level] ||
    x.ancestors.length - y.ancestors.length ||
    x.turnIndex - y.turnIndex ||
    a.measurement.recordId.localeCompare(b.measurement.recordId)
  )
}

