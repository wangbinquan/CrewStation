import { afterEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit'
import { jsonHash } from '@crewstation/kernel'
import { originalReportSnapshotSession } from '@crewstation/persistence'
import { completeCoverageWorkspace } from '../../../adapters/persistence/completeCoverageWorkspace'
import type { PackedCoverageRoots } from '../../../adapters/persistence/completeCoverage/rootDocuments'
import { coveragePrefixMaximum, insertCoverageInterval } from '../../../domain/coverageIntervalIndex'
import { modelAnyProvider, modelPartition, treeKey } from '../../../domain/complete-usage/coverageKeys'
import { TOKEN_BUCKETS, type TokenBucket } from '../../../domain/tokenUsage'
import type { CompleteWorkingPage } from '../../../ports/completeWorkingRows'

const available = await testDatabaseAvailable()
let tdb: TestDatabase
afterEach(async () => { await tdb?.drop() })

function originalPartitions() {
  const cases: [string, string, boolean, string][] = []
  for (let i = 0; i < 4101; i++) cases.push(['same-original-group', 'same-original-session', false, modelPartition('model-' + i, i % 2 ? 'provider-A' : null)])
  const partitions = ['all', 'null', modelAnyProvider('shared-model'), modelPartition('shared-model', null), modelPartition('shared-model', 'provider-A'), modelPartition('shared-model', 'provider-B')]
  for (const group of ['original-group-A', 'original-group-B']) for (const session of ['original-session-A', 'original-session-B'])
    for (const treeOnly of [false, true]) for (const model of partitions) cases.push([group, session, treeOnly, model])
  return cases
}

describe.skipIf(!available)('original PG coverage roots with fixed four-bucket physical shards', () => {
  test('all 4101 model/provider shards and every original partition survive actual EOF, cache eviction and reopen', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const namespace = 'packed-original-population', writer = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      const cases = originalPartitions(), expected = new Map<string, { id: string; point: [number, number] }>()
      for (let first = 0; first < cases.length; first += 100) {
        const batch = cases.slice(first, first + 100), trees = batch.flatMap(([group, session, treeOnly, model]) => TOKEN_BUCKETS.map(bucket => treeKey(group, bucket, session, treeOnly, model)))
        await writer.prefetchRoots(trees)
        for (const tree of trees) {
          const id = expected.size + 1, point: [number, number] = id === 1 ? [5, 2] : [id * 17, id * 17 + 7]
          await insertCoverageInterval(writer.coverage, tree, { start: point[0], end: point[1] })
          expected.set(tree, { id: String(id), point })
        }
      }
      await writer.flush()
      const counts = await snapshot.executor.execute<{ namespace: string; count: string }>(sql`SELECT namespace,count(*)::text AS count FROM pg_temp.cs_report_workspace GROUP BY namespace ORDER BY namespace`)
      expect([...counts]).toEqual([{ namespace: namespace + '/packed-roots', count: String(cases.length) }])
      let cursor: string | null = null, physical = 0, logical = 0
      for (;;) {
        const page: CompleteWorkingPage<PackedCoverageRoots> = await snapshot.workspace.page<PackedCoverageRoots>(namespace + '/packed-roots', cursor, 127)
        for (const row of page.items) {
          expect(Object.keys(row.document.slots)).toHaveLength(4)
          expect(row.key).toBe(jsonHash(JSON.stringify(['coverage-packed-root/1', ...row.document.common])))
          for (const [bucket, slot] of Object.entries(row.document.slots)) {
            const [group, session, treeOnly, model] = row.document.common, tree = treeKey(group, bucket as TokenBucket, session, treeOnly, model)
            const original = expected.get(tree)
            expect(original).toBeDefined(); expect(slot).toEqual(original!); logical++
          }
          physical++
        }
        if (page.nextCursor === null) break
        cursor = page.nextCursor
      }
      expect(physical).toBe(4149); expect(logical).toBe(16596); expect(logical).toBe(expected.size)
      const reader = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash), entries = [...expected]
      for (let first = 0; first < entries.length; first += 400) {
        const batch = entries.slice(first, first + 400)
        await reader.prefetchRoots(batch.map(([tree]) => tree))
        for (const [tree, original] of batch) {
          expect(await reader.coverage.root(tree)).toBe(original.id)
          expect(await coveragePrefixMaximum(reader.coverage, tree, original.point[0] - 1)).toBeNull()
          expect(await coveragePrefixMaximum(reader.coverage, tree, original.point[0])).toBe(original.point[1])
        }
      }
    })
  }, 30000)

  test('canonical independent buckets retain original rotations and prefix maxima after every flush', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const namespace = 'packed-original-rotations', writer = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      for (const [provider, starts] of [['provider-A', [10, 30, 50, 2, 9]], ['provider-B', [50, 30, 10, 60, 51]]] as const) {
        for (const bucket of TOKEN_BUCKETS) {
          const tree = treeKey('original-rotation-group', bucket, 'original-session', provider === 'provider-B', modelPartition('actual-model', provider)), intervals: { start: number; end: number }[] = []
          for (const start of starts) {
            intervals.push({ start, end: start + (start === 9 ? 91 : 5) })
            await insertCoverageInterval(writer.coverage, tree, intervals.at(-1)!); await writer.flush()
            const reader = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
            for (const bound of [0, 2, 9, 10, 29, 30, 49, 50, 51, 60, 100]) {
              const ends = intervals.filter(interval => interval.start <= bound).map(interval => interval.end)
              expect(await coveragePrefixMaximum(reader.coverage, tree, bound)).toBe(ends.length ? Math.max(...ends) : null)
            }
          }
        }
      }
      const page = await snapshot.workspace.page<PackedCoverageRoots>(namespace + '/packed-roots', null, 100)
      expect(page.items).toHaveLength(2); expect(page.nextCursor).toBeNull()
      for (const row of page.items) for (const slot of Object.values(row.document.slots)) expect(slot.point).toBeUndefined()
      const nodes = await snapshot.workspace.page(namespace + '/nodes', null, 100)
      expect(nodes.items).toHaveLength(40); expect(nodes.nextCursor).toBeNull()
    })
  }, 30000)
})
