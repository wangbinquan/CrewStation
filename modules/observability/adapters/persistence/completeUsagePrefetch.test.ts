// RFC-034: prefetched absence cannot replace newer original writes or hide failed EOF.
import { expect, test } from 'bun:test'
import { completeAncestryWorkspace } from './completeAncestryWorkspace'
import { completeCoverageWorkspace } from './completeCoverageWorkspace'
import { completeUsagePrefetch } from './completeUsagePrefetch'
import type { CompleteWorkingRows, CompleteWorkingRow } from '../../ports/completeWorkingRows'
import type { UsageContributionEvidence } from '../../domain/completeUsageEvidence'
import { completeUsageGroup } from '../../domain/completeUsageOrder'

function originalRows() {
  const spaces = new Map<string, Map<string, unknown>>()
  const space = (name: string) => {
    let found = spaces.get(name)
    if (!found) {
      found = new Map()
      spaces.set(name, found)
    }
    return found
  }
  const save = (name: string, rows: readonly CompleteWorkingRow[]) => {
    for (const row of rows) space(name).set(row.key, structuredClone(row.document))
  }
  const rows: CompleteWorkingRows = {
    async insert(name, items) {
      for (const item of items) if (space(name).has(item.key)) throw new Error('duplicate original')
      save(name, items)
    },
    async upsert(name, items) {
      save(name, items)
    },
    async put(name, item) {
      save(name, [item])
    },
    async get<T>(name: string, key: string) {
      return structuredClone(space(name).get(key)) as T | undefined
    },
    async getMany<T>(name: string, keys: readonly string[]) {
      return keys.flatMap((key) => (space(name).has(key) ? [{ key, document: structuredClone(space(name).get(key)) as T }] : []))
    },
    async page<T>(name: string, after: string | null, size = 100) {
      const all = [...space(name)].filter(([key]) => after === null || key > after).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      const items = all.slice(0, size).map(([key, document]) => ({
        key,
        document: structuredClone(document) as T,
      }))
      return {
        items,
        nextCursor: all.length > size ? items.at(-1)!.key : null,
      }
    },
    async clear(name) {
      spaces.delete(name)
    },
    async clearTree(name) {
      for (const key of spaces.keys()) if (key === name || key.startsWith(name + '/')) spaces.delete(key)
    },
  }
  return rows
}
function evidence(n: number): UsageContributionEvidence {
  return {
    sourceId: 'original-race',
    measurement: {
      invocationId: 'group',
      recordId: String(n),
      model: null,
      scope: {
        root: 'root',
        session: 'leaf-' + n,
        parentSession: 'root',
        ancestors: ['root'],
        turn: 'turn',
        turnIndex: n,
        level: 'self-total',
      },
    },
    contribution: { input: '1', cacheRead: '3', cacheWrite: '5', output: '7' },
    complete: true,
  }
}
function deferredRead(rows: CompleteWorkingRows) {
  let enter!: () => void,
    release!: () => void,
    first = true
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    blocked = new Promise<void>((resolve) => {
      release = resolve
    })
  const original = rows.getMany.bind(rows)
  rows.getMany = async <T>(name: string, keys: readonly string[]) => {
    const found = await original<T>(name, keys)
    if (first) {
      first = false
      enter()
      await blocked
    }
    return found
  }
  return { entered, release }
}

test('a delayed ancestry batch cannot resurrect absence after newer paths are flushed and evicted', async () => {
  const rows = originalRows(),
    delayed = deferredRead(rows),
    workspace = completeAncestryWorkspace(rows, 'ancestry', (value) => value)
  const record = evidence(0),
    group = completeUsageGroup(record),
    waiting = workspace.prefetch([record])
  await delayed.entered
  await workspace.bind(group, 'leaf-0', ['actual-root'])
  await workspace.flush()
  await workspace.prefetch(Array.from({ length: 5001 }, (_, n) => evidence(n + 1)))
  delayed.release()
  await waiting
  await expect(workspace.bind(group, 'leaf-0', ['wrong-root'])).rejects.toThrow('Conflicting observation session ancestry')
})

test('a delayed root batch cannot resurrect absence after a newer root is flushed and evicted', async () => {
  const rows = originalRows()
  await rows.put('coverage/roots', {
    key: 'retained',
    document: { tree: 'retained', id: null },
  })
  const delayed = deferredRead(rows),
    workspace = completeCoverageWorkspace(rows, 'coverage', (value) => value),
    waiting = workspace.prefetchRoots(['retained', 'actual-root'])
  await delayed.entered
  await workspace.coverage.setRoot('actual-root', 'new-node')
  await workspace.flush()
  await workspace.prefetchRoots(Array.from({ length: 5001 }, (_, n) => 'other-' + n))
  delayed.release()
  await waiting
  expect(await workspace.coverage.root('actual-root')).toBe('new-node')
})

test('actual root identity is still checked after a bulk read', async () => {
  const rows = originalRows()
  await rows.put('coverage/roots', {
    key: 'retained',
    document: { tree: 'retained', id: null },
  })
  await rows.put('coverage/roots', {
    key: 'requested',
    document: { tree: 'wrong-tree', id: 'wrong-node' },
  })
  const workspace = completeCoverageWorkspace(rows, 'coverage', (value) => value)
  await workspace.prefetchRoots(['retained', 'requested'])
  await expect(workspace.coverage.root('requested')).rejects.toThrow('Coverage root key identity conflict')
})

test('query failure propagates through ancestry and root prefetch', async () => {
  const rows = originalRows(),
    failure = new Error('original TEMP connection closed')
  rows.getMany = async () => {
    throw failure
  }
  await expect(completeAncestryWorkspace(rows, 'ancestry', (value) => value).prefetch([evidence(0)])).rejects.toBe(failure)
  await rows.put('coverage/roots', {
    key: 'retained',
    document: { tree: 'retained', id: null },
  })
  await expect(completeCoverageWorkspace(rows, 'coverage', (value) => value).prefetchRoots(['retained', 'new-root'])).rejects.toBe(failure)
})

test('transport batching preserves more than one packet and the actual final EOF', async () => {
  let eof = false
  async function* original() {
    for (let n = 0; n < 1201; n++) yield n
    eof = true
  }
  const batches: number[] = [],
    seen: number[] = []
  for await (const n of completeUsagePrefetch(original(), async (batch) => {
    batches.push(batch.length)
  }))
    seen.push(n)
  expect(seen).toEqual(Array.from({ length: 1201 }, (_, n) => n))
  expect(batches).toEqual([...Array<number>(12).fill(100), 1])
  expect(eof).toBe(true)
})

test('failed or aborted preparation closes the original iterator and never presents its unread EOF', async () => {
  for (const abort of [false, true]) {
    let closed = false,
      eof = false,
      read = 0
    async function* original() {
      try {
        for (let n = 0; n < 1201; n++) {
          read++
          yield n
        }
        eof = true
      } finally {
        closed = true
      }
    }
    const controller = new AbortController(),
      failure = new Error(abort ? 'original source cancelled' : 'original batch failed'),
      seen: number[] = []
    const drain = async () => {
      for await (const n of completeUsagePrefetch(
        original(),
        async () => {
          if (abort) controller.abort(failure)
          else throw failure
        },
        controller.signal,
      ))
        seen.push(n)
    }
    await expect(drain()).rejects.toBe(failure)
    expect(closed).toBe(true)
    expect(eof).toBe(false)
    expect(read).toBe(100)
    expect(seen).toEqual([])
  }
})

function deferredPointRead(rows: CompleteWorkingRows) {
  let enter!: () => void,
    release!: () => void,
    first = true
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    blocked = new Promise<void>((resolve) => {
      release = resolve
    })
  const original = rows.get.bind(rows)
  rows.get = async <T>(name: string, key: string) => {
    const found = await original<T>(name, key)
    if (first) {
      first = false
      enter()
      await blocked
    }
    return found
  }
  return { entered, release }
}

test('a cold point read cannot restore a root overwritten and evicted while the read awaited', async () => {
  const rows = originalRows()
  await rows.put('coverage/roots', { key: 'retained', document: { tree: 'retained', id: null } })
  const workspace = completeCoverageWorkspace(rows, 'coverage', (value) => value)
  await workspace.coverage.root('retained')
  const delayed = deferredPointRead(rows),
    waiting = workspace.coverage.root('actual-root')
  await delayed.entered
  await workspace.coverage.setRoot('actual-root', 'new-node')
  await workspace.flush()
  await workspace.prefetchRoots(Array.from({ length: 5001 }, (_, n) => 'other-' + n))
  delayed.release()
  expect(await waiting).toBe('new-node')
})

test('a cold ancestry point read cannot erase a newer conflicting path after flush and eviction', async () => {
  const rows = originalRows(),
    delayed = deferredPointRead(rows),
    workspace = completeAncestryWorkspace(rows, 'ancestry', (value) => value)
  const group = completeUsageGroup(evidence(0)),
    waiting = workspace.bind(group, 'leaf-0', ['wrong-root'])
  await delayed.entered
  await workspace.bind(group, 'leaf-0', ['actual-root'])
  await workspace.flush()
  await workspace.prefetch(Array.from({ length: 5001 }, (_, n) => evidence(n + 1)))
  delayed.release()
  await expect(waiting).rejects.toThrow('Conflicting observation session ancestry')
})
