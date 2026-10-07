import { afterEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit'
import { jsonHash } from '@crewstation/kernel'
import { originalReportSnapshotSession } from '@crewstation/persistence'
import { completeCoverageWorkspace } from '../../../adapters/persistence/completeCoverageWorkspace'
import { treeKey } from '../../../domain/complete-usage/coverageKeys'
import type { CompleteWorkingRows } from '../../../ports/completeWorkingRows'

const available = await testDatabaseAvailable()
let tdb: TestDatabase
afterEach(async () => { await tdb?.drop() })
function barrier() {
  let release!: () => void, enter!: () => void
  const pending = new Promise<void>(resolve => { release = resolve }), began = new Promise<void>(resolve => { enter = resolve })
  return { release, enter, pending, began }
}

describe.skipIf(!available)('original PG packed root read and write races', () => {
  test('a canonical write invalidates a waiting empty proof before the first cache is evicted', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const gate = barrier(), originalPage = snapshot.workspace.page.bind(snapshot.workspace), namespace = 'packed-empty-race'
      let wait = true
      snapshot.workspace.page = (async (space, cursor, size) => {
        if (wait && space.endsWith('/roots')) { wait = false; gate.enter(); await gate.pending; return { items: [], nextCursor: null } }
        return originalPage(space, cursor, size)
      }) as CompleteWorkingRows['page']
      const tree = treeKey('actual-group', 'input', 'actual-session', false, 'all'), writer = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      const reading = writer.coverage.root(tree); await gate.began
      await writer.coverage.setRoot(tree, 'actual-node'); gate.release(); expect(await reading).toBe('actual-node')
      snapshot.workspace.page = originalPage; await writer.flush()
      await writer.prefetchRoots(Array.from({ length: 5001 }, (_, i) => treeKey('later-group-' + i, 'input', 'actual-session', false, 'all')))
      expect(await writer.coverage.root(tree)).toBe('actual-node')
      const reopened = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      expect(await reopened.coverage.root(tree)).toBe('actual-node')
    })
  }, 30000)

  test('a stale packed prefetch cannot resurrect the old root after a completed original write', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const namespace = 'packed-prefetch-race', tree = treeKey('actual-group', 'input', 'actual-session', false, 'all')
      const original = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      await original.coverage.setRoot(tree, 'old-node'); await original.flush()
      const reader = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      expect(await reader.coverage.root(treeKey('probe-group', 'input', 'actual-session', false, 'all'))).toBeNull()
      const gate = barrier(), originalGetMany = snapshot.workspace.getMany.bind(snapshot.workspace); let wait = true
      snapshot.workspace.getMany = (async (space, keys) => {
        const retained = await originalGetMany(space, keys)
        if (wait && space.endsWith('/packed-roots')) { wait = false; gate.enter(); await gate.pending }
        return retained
      }) as CompleteWorkingRows['getMany']
      const pending = reader.prefetchRoots([tree]); await gate.began
      await reader.coverage.setRoot(tree, 'new-node'); await reader.flush(); gate.release(); await pending
      snapshot.workspace.getMany = originalGetMany
      expect(await reader.coverage.root(tree)).toBe('new-node')
      const reopened = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      expect(await reopened.coverage.root(tree)).toBe('new-node')
    })
  }, 30000)

  test('an awaited flush preserves a newer logical root and every other fixed bucket slot', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const namespace = 'packed-flush-race', input = treeKey('actual-group', 'input', 'actual-session', false, 'all'), output = treeKey('actual-group', 'output', 'actual-session', false, 'all')
      const writer = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      await writer.coverage.setRoot(input, 'old-input'); await writer.coverage.setRoot(output, 'original-output')
      const gate = barrier(), originalUpsert = snapshot.workspace.upsert.bind(snapshot.workspace); let wait = true
      snapshot.workspace.upsert = async (space, rows) => {
        if (wait && space.endsWith('/packed-roots')) { wait = false; gate.enter(); await gate.pending }
        await originalUpsert(space, rows)
      }
      const flushing = writer.flush(); await gate.began
      await writer.coverage.setRoot(input, 'new-input'); gate.release(); await flushing
      snapshot.workspace.upsert = originalUpsert
      const reopened = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      expect(await reopened.coverage.root(input)).toBe('new-input'); expect(await reopened.coverage.root(output)).toBe('original-output')
      await writer.flush()
      const again = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      expect(await again.coverage.root(input)).toBe('new-input'); expect(await again.coverage.root(output)).toBe('original-output')
    })
  }, 30000)
})
