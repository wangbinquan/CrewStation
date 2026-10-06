import type { UsageContributionEvidence } from '../../domain/completeUsageEvidence'
import type { CompleteWorkingRows, CompleteWorkingRow, CompleteWorkingPage } from '../../ports/completeWorkingRows'
import type { CompleteUsageWorkspace, CompleteUsageOrdering } from '../../ports/completeUsageWorkspace'
import { completeOrdinalKey } from '../../domain/completeOrdinal'
import { compareCompleteUsage } from '../../domain/completeUsageOrder'
import { completeCoverageWorkspace } from './completeCoverageWorkspace'
import { completeAncestryWorkspace } from './completeAncestryWorkspace'
import { completeNativeScopeWorkspace } from './completeNativeScopeWorkspace'
import type { CompleteNativeScopeSource, CompleteNativeCacheFactory } from '../../ports/completeNativeScope'
import { completeUsagePrefetch } from './completeUsagePrefetch'
import { completeCoverageRootReads } from '../../domain/complete-usage/coverageKeys'

async function* retainedInput<T>(input: {
  readonly rows: CompleteWorkingRows
  readonly namespace: string
  readonly sealed: () => boolean
  readonly count: () => bigint
  readonly signal?: AbortSignal
}) {
  if (!input.sealed()) throw new Error('Complete usage input is not sealed')
  let after: string | null = null,
    seen = 0n
  for (;;) {
    input.signal?.throwIfAborted()
    const page: CompleteWorkingPage<T> = await input.rows.page<T>(input.namespace, after, 100)
    for (const row of page.items) {
      if (row.key !== completeOrdinalKey(seen++)) throw new Error('Complete usage input ordinal missing')
      yield row.document
    }
    if (page.nextCursor === null) {
      if (seen !== input.count()) throw new Error('Complete usage input row count changed')
      return
    }
    if (!page.items.length || page.nextCursor !== page.items.at(-1)!.key || page.nextCursor === after)
      throw new Error('Complete usage input cursor did not advance')
    after = page.nextCursor
  }
}

async function flushUsageAllocations(rows: CompleteWorkingRows, namespace: string, pending: CompleteWorkingRow[]) {
  if (!pending.length) return
  await rows.insert(namespace, pending)
  pending.length = 0
}

/** One immutable input population precedes ancestry, ordering and selection. */
interface UsageWorkspaceInput<T extends UsageContributionEvidence> {
  readonly rows: CompleteWorkingRows
  readonly namespace: string
  readonly keyOf: (value: string) => string
  readonly identity: (record: T) => string
  readonly signal?: AbortSignal
  readonly order: CompleteUsageOrdering<T>
  readonly nativeSource?: CompleteNativeScopeSource
  readonly nativeCache?: CompleteNativeCacheFactory
}

export function completeUsageWorkspace<T extends UsageContributionEvidence>(input: UsageWorkspaceInput<T>) {
  const space = (suffix: string) => `${input.namespace}/${suffix}`
  const coverage = completeCoverageWorkspace(input.rows, space('coverage'), input.keyOf)
  const ancestry = completeAncestryWorkspace(input.rows, space('ancestry'), input.keyOf, input.signal)
  if (input.nativeSource && !input.nativeCache) throw new Error('Paged native scope requires the original derived-row cache')
  const native = input.nativeSource ? completeNativeScopeWorkspace({ rows: input.rows, namespace: space('native-ancestry'), keyOf: input.keyOf, source: input.nativeSource, cache: input.nativeCache!, legacyPath: ancestry.retained, signal: input.signal }) : undefined
  const pendingAllocations: CompleteWorkingRow[] = []
  let count = 0n,
    allocations = 0n,
    sealed = false
  let sort: ReturnType<CompleteUsageOrdering<T>> | undefined
  const flushAllocations = () => flushUsageAllocations(input.rows, space('allocations'), pendingAllocations)
  const records = () =>
    retainedInput<T>({
      rows: input.rows,
      namespace: space('input'),
      sealed: () => sealed,
      count: () => count,
      signal: input.signal,
    })
  const workspace: CompleteUsageWorkspace<T> = {
    coverage: coverage.coverage,
    ...(native ? { native } : {}),
    records: () => completeUsagePrefetch(records(), ancestry.prefetch, input.signal),
    orderedRecords: async function* () {
      sort ??= input.order({
        workspace: input.rows,
        namespace: space('sort'),
        records: records(),
        compare: compareCompleteUsage,
        signal: input.signal,
      })
      yield* completeUsagePrefetch((await sort).records(), (batch) => coverage.prefetchRoots(completeCoverageRootReads(batch)), input.signal)
    },
    bindAncestry: ancestry.bind,
    async allocate(record, contribution, quality) {
      pendingAllocations.push({
        key: completeOrdinalKey(allocations++),
        document: { record, contribution, quality },
      })
      if (pendingAllocations.length === 500) await flushAllocations()
    },
  }
  return {
    workspace,
    async append(items: readonly T[]) {
      if (sealed) throw new Error('Complete usage input is already sealed')
      for (let offset = 0; offset < items.length; offset += 500) {
        input.signal?.throwIfAborted()
        const batch = items.slice(offset, offset + 500)
        await input.rows.insert(
          space('identities'),
          batch.map((record) => ({
            key: input.keyOf(input.identity(record)),
            document: true,
          })),
        )
        await input.rows.insert(
          space('input'),
          batch.map((document, i) => ({
            key: completeOrdinalKey(count + BigInt(i)),
            document,
          })),
        )
        count += BigInt(batch.length)
      }
    },
    seal(expectedRows: string) {
      if (sealed || !/^(0|[1-9]\d*)$/.test(expectedRows) || BigInt(expectedRows) !== count) throw new Error('Complete usage input EOF count does not match')
      sealed = true
    },
    async flush() {
      input.signal?.throwIfAborted()
      await ancestry.flush()
      await flushAllocations()
      await coverage.flush()
    },
    allocationsNamespace: space('allocations'),
  }
}
