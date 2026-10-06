import type { CompleteWorkingRows, CompleteWorkingRow } from '../../ports/completeWorkingRows'
import type { CoverageIntervalStore, CoverageIntervalNode } from '../../domain/coverageIntervalIndex'
interface Root {
  readonly tree: string
  readonly id: string | null
  /** A single original interval needs no second TEMP row or node index. */
  readonly point?: readonly [number, number]
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

interface RootReader {
  rows: CompleteWorkingRows
  rootSpace: string
  keyOf: (value: string) => string
  roots: Map<string, Root>
  dirtyRoots: Map<string, Root>
  empty: () => boolean | undefined
  setEmpty: (value: boolean) => void
  revision: () => bigint
}

async function readRoot(input: RootReader, tree: string) {
  const { rows, rootSpace, keyOf, roots, dirtyRoots } = input
  const key = keyOf(tree)
  let row = roots.get(key) ?? dirtyRoots.get(key)
  // Only an affirmative original TEMP EOF permits this empty-relation shortcut.
  if (!row && input.empty() === true) return null
  if (!row && input.empty() === undefined) {
    const first = await rows.page<Root>(rootSpace, null, 1)
    if (input.empty() === undefined) input.setEmpty(first.items.length === 0 && first.nextCursor === null)
    row = roots.get(key) ?? dirtyRoots.get(key)
  }
  while (!row) {
    const before = input.revision()
    const retained = await rows.get<Root>(rootSpace, key)
    row = roots.get(key) ?? dirtyRoots.get(key)
    if (!row && before !== input.revision()) continue
    row ??= retained
    if (!row) { remember(roots, key, { tree, id: null }); return null }
  }
  if (row.tree !== tree) throw new Error('Coverage root key identity conflict')
  remember(roots, key, row)
  return row.id
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
  const read = { rows, rootSpace, keyOf, roots, dirtyRoots, empty: () => originalRootsEmpty,
    setEmpty: (value: boolean) => { originalRootsEmpty = value }, revision: () => rootWrites }
  const coverage: CoverageIntervalStore = {
    root: (tree) => readRoot(read, tree),
    async setRoot(tree, id) {
      rootWrites++
      originalRootsEmpty = false
      const key = keyOf(tree), current = roots.get(key) ?? dirtyRoots.get(key),
        nodeId = nodeKey(tree, id), pending = dirtyNodes.get(nodeId)
      const leaf = pending && pending.left === null && pending.right === null && pending.height === 1 && pending.maximum === pending.end
      const row: Root = current?.id === id && current.point ? current
        : current?.id == null && leaf ? { tree, id, point: [pending.start, pending.end] } : { tree, id }
      if (row.point) { dirtyNodes.delete(nodeId); nodes.delete(nodeId) }
      remember(roots, key, row)
      dirtyRoots.set(key, row)
      if (dirtyRoots.size === 500) await flushRows(rows, rootSpace, dirtyRoots)
    },
    async node(tree, id) {
      await coverage.root(tree)
      const root = roots.get(keyOf(tree)) ?? dirtyRoots.get(keyOf(tree))
      if (root?.id === id && root.point) {
        if (root.point.length !== 2 || !root.point.every(Number.isSafeInteger)) throw new Error('Coverage point interval invalid')
        return { id, start: root.point[0], end: root.point[1], maximum: root.point[1], height: 1, left: null, right: null }
      }
      const key = nodeKey(tree, id),
        row = nodes.get(key) ?? dirtyNodes.get(key) ?? (await rows.get<CoverageIntervalNode>(nodeSpace, key))
      if (!row || row.id !== id) throw new Error('Coverage interval node missing')
      remember(nodes, key, row)
      return { ...row }
    },
    async save(tree, node) {
      await coverage.root(tree)
      const rootKey = keyOf(tree), root = roots.get(rootKey) ?? dirtyRoots.get(rootKey)
      if (root?.id === node.id && root.point) {
        const leaf = node.left === null && node.right === null && node.height === 1 && node.maximum === node.end
        const row: Root = leaf ? { tree, id: node.id, point: [node.start, node.end] } : { tree, id: node.id }
        rootWrites++; remember(roots, rootKey, row); dirtyRoots.set(rootKey, row)
        if (leaf) {
          if (dirtyRoots.size === 500) await flushRows(rows, rootSpace, dirtyRoots)
          return
        }
      }
      // Keep a new first leaf pending until the original setRoot retains its exact point.
      if (dirtyNodes.size === 499 && root?.id == null && node.left === null && node.right === null && node.height === 1 && node.maximum === node.end && !dirtyNodes.has(nodeKey(tree, node.id))) await flushRows(rows, nodeSpace, dirtyNodes)
      const key = nodeKey(tree, node.id),
        copy = { ...node }
      remember(nodes, key, copy)
      dirtyNodes.set(key, copy)
      if (dirtyNodes.size === 500) await flushRows(rows, nodeSpace, dirtyNodes)
      if (dirtyRoots.size === 500) await flushRows(rows, rootSpace, dirtyRoots)
    },
    async allocateId() {
      return String(++sequence)
    },
  }
  const prefetch = { ...read, coverage }
  return {
    coverage,
    prefetchRoots: (trees: Iterable<string>) => prefetchRoots(prefetch, trees),
    flush: async () => {
      await flushRows(rows, rootSpace, dirtyRoots)
      await flushRows(rows, nodeSpace, dirtyNodes)
    },
  }
}
