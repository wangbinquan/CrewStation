import type { CompleteWorkingRows } from '../../ports/completeWorkingRows'
import type { CoverageIntervalStore, CoverageIntervalNode } from '../../domain/coverageIntervalIndex'
import { CoverageRootStore } from './completeCoverage/rootStore'
import { createCoverageBuffers } from './completeCoverage/buffers'
import type { CoverageRoot as Root } from './completeCoverage/rootDocuments'
const remember = <T>(cache: Map<string, T>, key: string, value: T) => {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > 4096) cache.delete(cache.keys().next().value!)
}

interface RootReader {
  store: CoverageRootStore
  keyOf: (value: string) => string
  roots: Map<string, Root>
  dirtyRoots: Map<string, Root>
  revision: () => bigint
}

async function readRoot(input: RootReader, tree: string) {
  const { store, keyOf, roots, dirtyRoots } = input
  const key = keyOf(tree)
  let row = roots.get(key) ?? dirtyRoots.get(key)
  // Only an affirmative original TEMP EOF permits this empty-relation shortcut.
  if (!row && store.empty(tree) === true) return null
  if (!row && store.empty(tree) === undefined) {
    await store.probe(tree)
    row = roots.get(key) ?? dirtyRoots.get(key)
  }
  while (!row) {
    const before = input.revision()
    const retained = await store.get(tree)
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
    store: CoverageRootStore
    keyOf: (value: string) => string
    roots: Map<string, Root>
    dirtyRoots: Map<string, Root>
    coverage: CoverageIntervalStore
    revision: () => bigint
  },
  trees: Iterable<string>,
) {
  const { store, keyOf, roots, dirtyRoots, coverage } = input
  const wanted = new Map<string, string>()
  async function load() {
    const batch = new Map(wanted)
    wanted.clear()
    const before = input.revision()
    const found = await store.getMany([...batch.values()])
    // setRoot owns newer facts, including writes already flushed or evicted while this read waited.
    if (input.revision() !== before) return
    const actual = new Map(found.map((row) => [row.key, row.document]))
    for (const [key, tree] of batch) if (!roots.has(key) && !dirtyRoots.has(key)) remember(roots, key, actual.get(key) ?? { tree, id: null })
  }
  for (const tree of trees) {
    if (store.empty(tree) === undefined) await coverage.root(tree)
    if (store.empty(tree) === true) continue
    const key = keyOf(tree)
    const retained = roots.get(key) ?? dirtyRoots.get(key), prior = wanted.get(key)
    if (retained && retained.tree !== tree || prior !== undefined && prior !== tree) throw new Error('Coverage root key identity conflict')
    if (retained) continue
    wanted.set(key, tree)
    if (wanted.size === 500) await load()
  }
  if (wanted.size) await load()
}

/** Bounded dirty buffers and caches; authority remains the original connection's TEMP rows. */
export function completeCoverageWorkspace(rows: CompleteWorkingRows, namespace: string, keyOf: (value: string) => string) {
  const nodeSpace = `${namespace}/nodes`, store = new CoverageRootStore(rows, namespace, keyOf)
  const { roots, nodes, dirtyRoots, dirtyNodes, flushRoots, flushNodes } = createCoverageBuffers(rows, nodeSpace, store)
  let sequence = 0n, rootWrites = 0n
  const nodeKey = (tree: string, id: string) => keyOf(JSON.stringify([tree, id]))
  const read = { store, keyOf, roots, dirtyRoots, revision: () => rootWrites }
  const coverage: CoverageIntervalStore = {
    root: (tree) => readRoot(read, tree),
    async setRoot(tree, id) {
      rootWrites++
      store.written(tree)
      const key = keyOf(tree), current = roots.get(key) ?? dirtyRoots.get(key),
        nodeId = nodeKey(tree, id), pending = dirtyNodes.get(nodeId)
      if (current && current.tree !== tree) throw new Error('Coverage root key identity conflict')
      const leaf = pending && pending.left === null && pending.right === null && pending.height === 1 && pending.maximum === pending.end
      const row: Root = current?.id === id && current.point ? current
        : current?.id == null && leaf ? { tree, id, point: [pending.start, pending.end] } : { tree, id }
      if (row.point) { dirtyNodes.delete(nodeId); nodes.delete(nodeId) }
      remember(roots, key, row)
      dirtyRoots.set(key, row)
      if (dirtyRoots.size >= 500) await flushRoots()
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
          if (dirtyRoots.size >= 500) await flushRoots()
          return
        }
      }
      // Keep a new first leaf pending until the original setRoot retains its exact point.
      if (dirtyNodes.size === 499 && root?.id == null && node.left === null && node.right === null && node.height === 1 && node.maximum === node.end && !dirtyNodes.has(nodeKey(tree, node.id))) await flushNodes()
      const key = nodeKey(tree, node.id),
        copy = { ...node }
      remember(nodes, key, copy)
      dirtyNodes.set(key, copy)
      if (dirtyNodes.size >= 500) await flushNodes()
      if (dirtyRoots.size >= 500) await flushRoots()
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
      await flushRoots()
      await flushNodes()
    },
  }
}
