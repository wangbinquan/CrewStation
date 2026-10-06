import type { UsageContributionEvidence } from '../completeUsageEvidence'
import { completeUsageGroup } from '../completeUsageOrder'
import { TOKEN_BUCKETS, type TokenBucket } from '../tokenUsage'
// These are the original selection key bytes, shared with read-only TEMP prefetch.
export const modelPartition = (id: string, provider: string | null) => JSON.stringify(['model', id, provider])
export const modelAnyProvider = (id: string) => JSON.stringify(['model', id])
export const treeKey = (group: string, bucket: TokenBucket, session: string, treeOnly: boolean, model: string) =>
  JSON.stringify([group, bucket, session, treeOnly, model])
/** Enumerate original reads lazily; no ancestry or population stopping condition. */
export function* completeCoverageRootReads(records: readonly UsageContributionEvidence[]) {
  for (const record of records) {
    const scope = record.measurement.scope
    if (!scope) continue
    const model = record.measurement.model,
      group = completeUsageGroup(record)
    const cover = ['null', ...(model === null ? [] : [modelPartition(model.id, model.provider)])]
    const overlap =
      model === null
        ? ['all']
        : [
            'null',
            model.provider === null ? modelAnyProvider(model.id) : modelPartition(model.id, model.provider),
            ...(model.provider === null ? [] : [modelPartition(model.id, null)]),
          ]
    for (const bucket of TOKEN_BUCKETS) {
      // Native parents are read in full by the qualified async source; this is only a self cache warm-up.
      const ancestors = 'ancestors' in scope ? scope.ancestors : []
      for (let i = -1; i < ancestors.length; i++) {
        const session = i < 0 ? scope.session : ancestors[i]!,
          treeOnly = i >= 0
        for (const partition of cover) yield treeKey(group, bucket, session, treeOnly, partition)
        for (const partition of overlap) yield treeKey(group, bucket, session, treeOnly, partition)
      }
      if (scope.level !== 'request' && record.contribution[bucket] !== null) {
        const partitions = model === null ? ['all', 'null'] : ['all', modelAnyProvider(model.id), modelPartition(model.id, model.provider)]
        for (const treeOnly of scope.level === 'tree-total' ? [false, true] : [false])
          for (const partition of partitions) yield treeKey(group, bucket, scope.session, treeOnly, partition)
      }
    }
  }
}
