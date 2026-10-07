import type { CompleteWorkingRows, CompleteWorkingRow } from '../../../ports/completeWorkingRows'
import type { CoverageIntervalNode } from '../../../domain/coverageIntervalIndex'
import type { CoverageRoot } from './rootDocuments'
import type { CoverageRootStore } from './rootStore'

async function flush<T>(dirty: Map<string, T>, write: (batch: readonly CompleteWorkingRow<T>[]) => Promise<void>) {
  while (dirty.size) {
    const batch: CompleteWorkingRow<T>[] = []
    for (const [key, document] of dirty) { batch.push({ key, document }); if (batch.length === 500) break }
    await write(batch)
    // A newer write made while this batch waited must remain dirty.
    for (const row of batch) if (dirty.get(row.key) === row.document) dirty.delete(row.key)
  }
}

export function createCoverageBuffers(rows: CompleteWorkingRows, nodeSpace: string, store: CoverageRootStore) {
  const roots = new Map<string, CoverageRoot>(), nodes = new Map<string, CoverageIntervalNode>()
  const dirtyRoots = new Map<string, CoverageRoot>(), dirtyNodes = new Map<string, CoverageIntervalNode>()
  let pending: Promise<void> = Promise.resolve()
  const serial = (write: () => Promise<void>) => {
    const next = pending.then(write)
    pending = next.then(() => undefined, () => undefined)
    return next
  }
  return {
    roots, nodes, dirtyRoots, dirtyNodes,
    flushRoots: () => serial(() => flush(dirtyRoots, batch => store.upsert(batch))),
    flushNodes: () => serial(() => flush(dirtyNodes, batch => rows.upsert(nodeSpace, batch))),
  }
}
