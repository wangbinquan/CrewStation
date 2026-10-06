import type { CompleteWorkingRows, CompleteWorkingRow } from '../../ports/completeWorkingRows'
import type { CoverageIntervalStore, CoverageIntervalNode } from '../../domain/coverageIntervalIndex'
interface Root {
  readonly tree: string
  readonly id: string | null
}
const remember = <T>(cache: Map<string, T>, key: string, value: T) => {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > 4096) cache.delete(cache.keys().next().value!)
}
const flushRows = async <T>(rows: CompleteWorkingRows, space: string, dirty: Map<string, T>) => {
  if (!dirty.size) return
  const batch: CompleteWorkingRow<T>[] = [...dirty].map(([key, document]) => ({ key, document }))
  await rows.upsert(space, batch)
  dirty.clear()
}

async function prefetchRoots(
  input: {
    rows: CompleteWorkingRows
    rootSpace: string
    keyOf: (value: string) => string
    roots: Map<string, Root>
    dirtyRoots: Map<string, Root>
    coverage: CoverageIntervalStore
    empty: () => boolean | undefined
    revision: () => bigint
  },
  trees: Iterable<string>,
) {
  const { rows, rootSpace, keyOf, roots, dirtyRoots, coverage } = input
  const wanted = new Map<string, string>()
  async function load() {
    const batch = new Map(wanted)
    wanted.clear()
    const before = input.revision()
    const found = await rows.getMany<Root>(rootSpace, [...batch.keys()])
    // setRoot owns newer facts, including writes already flushed or evicted while this read waited.
    if (input.revision() !== before) return
    const actual = new Map(found.map((row) => [row.key, row.document]))
    for (const [key, tree] of batch) if (!roots.has(key) && !dirtyRoots.has(key)) remember(roots, key, actual.get(key) ?? { tree, id: null })
  }
  for (const tree of trees) {
    if (input.empty() === undefined) await coverage.root(tree)
    if (input.empty() === true) continue
    const key = keyOf(tree)
    if (roots.has(key) || dirtyRoots.has(key)) continue
    wanted.set(key, tree)
    if (wanted.size === 500) await load()
  }
  if (wanted.size) await load()
}

/** Bounded dirty buffers and caches; authority remains the original connection's TEMP rows. */
export function completeCoverageWorkspace(rows: CompleteWorkingRows, namespace: string, keyOf: (value: string) => string) {
  const roots = new Map<string, Root>(),
    nodes = new Map<string, CoverageIntervalNode>()
  const dirtyRoots = new Map<string, Root>(),
    dirtyNodes = new Map<string, CoverageIntervalNode>()
  let sequence = 0n,
    rootWrites = 0n
  // Only an affirmative original TEMP EOF can prove the entire root relation empty.
  let originalRootsEmpty: boolean | undefined
  const rootSpace = `${namespace}/roots`,
    nodeSpace = `${namespace}/nodes`
  const nodeKey = (tree: string, id: string) => keyOf(JSON.stringify([tree, id]))
  const coverage: CoverageIntervalStore = {
    async root(tree) {
      const key = keyOf(tree)
      let row = roots.get(key) ?? dirtyRoots.get(key)
      // Retain the first original point read; only subsequent proven-empty reads are skipped.
      if (!row && originalRootsEmpty === true) return null
      if (!row && originalRootsEmpty === undefined) {
        const first = await rows.page<Root>(rootSpace, null, 1)
        // setRoot may have run while this bounded read was awaiting its original snapshot.
        if (originalRootsEmpty === undefined) originalRootsEmpty = first.items.length === 0 && first.nextCursor === null
        row = roots.get(key) ?? dirtyRoots.get(key)
      }
      while (!row) {
        const before = rootWrites
        const retained = await rows.get<Root>(rootSpace, key)
        row = roots.get(key) ?? dirtyRoots.get(key)
        if (!row && before !== rootWrites) continue
        row ??= retained
        if (!row) {
          remember(roots, key, { tree, id: null })
          return null
        }
      }
      if (row.tree !== tree) throw new Error('Coverage root key identity conflict')
      remember(roots, key, row)
      return row.id
    },
    async setRoot(tree, id) {
      rootWrites++
      originalRootsEmpty = false
      const key = keyOf(tree),
        row = { tree, id }
      remember(roots, key, row)
      dirtyRoots.set(key, row)
      if (dirtyRoots.size === 500) await flushRows(rows, rootSpace, dirtyRoots)
    },
    async node(tree, id) {
      const key = nodeKey(tree, id),
        row = nodes.get(key) ?? dirtyNodes.get(key) ?? (await rows.get<CoverageIntervalNode>(nodeSpace, key))
      if (!row || row.id !== id) throw new Error('Coverage interval node missing')
      remember(nodes, key, row)
      return { ...row }
    },
    async save(tree, node) {
      const key = nodeKey(tree, node.id),
        copy = { ...node }
      remember(nodes, key, copy)
      dirtyNodes.set(key, copy)
      if (dirtyNodes.size === 500) await flushRows(rows, nodeSpace, dirtyNodes)
    },
    async allocateId() {
      return String(++sequence)
    },
  }
  const prefetch = { rows, rootSpace, keyOf, roots, dirtyRoots, coverage, empty: () => originalRootsEmpty, revision: () => rootWrites }
  return {
    coverage,
    prefetchRoots: (trees: Iterable<string>) => prefetchRoots(prefetch, trees),
    flush: async () => {
      await flushRows(rows, rootSpace, dirtyRoots)
      await flushRows(rows, nodeSpace, dirtyNodes)
    },
  }
}
