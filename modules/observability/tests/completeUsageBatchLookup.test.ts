// RFC-034: real TEMP batch reads must retain every allocation, ancestry and four-bucket decision.
import { afterEach, describe, expect, test } from 'bun:test'
import { jsonHash } from '@crewstation/kernel'
import { originalReportSnapshotSession } from '@crewstation/persistence'
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit'
import { completeStatisticsWorkspace } from '../wiring'
import { selectCompleteUsage } from '../application/completeUsageSelection'
import { completeWorkingTraversal } from '../application/completeWorkingTraversal'
import type { CompleteWorkingRows } from '../ports/completeWorkingRows'
import type { UsageContributionEvidence } from '../domain/completeUsageEvidence'
const available = await testDatabaseAvailable()
let tdb: TestDatabase
afterEach(async () => {
  await tdb?.drop()
})
const tokens = { input: '1', cacheRead: '3', cacheWrite: '5', output: '7' }
const identity = (row: UsageContributionEvidence) => JSON.stringify([row.sourceId, row.measurement.invocationId, row.measurement.recordId])
function leaf(n: number): UsageContributionEvidence {
  return {
    sourceId: 'batch-original',
    measurement: {
      invocationId: 'same-original-group',
      recordId: 'original-' + n,
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
    contribution: tokens,
    complete: true,
  }
}
function measured(rows: CompleteWorkingRows) {
  const points: string[] = [],
    batches: Array<{ namespace: string; keys: number }> = []
  const original: CompleteWorkingRows = {
    ...rows,
    async get<T>(namespace: string, key: string) {
      points.push(namespace)
      return rows.get<T>(namespace, key)
    },
    async getMany<T>(namespace: string, keys: readonly string[]) {
      batches.push({ namespace, keys: keys.length })
      return rows.getMany<T>(namespace, keys)
    },
  }
  return { rows: original, points, batches }
}
describe.skipIf(!available)('complete usage original PostgreSQL batch reads', () => {
  test('1201 unique self-total sessions use actual bulk reads and preserve the entire original allocation EOF', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async (snapshot) => {
      const observed = measured(snapshot.workspace),
        retention = completeStatisticsWorkspace({
          rows: observed.rows,
          namespace: 'original-batch',
          keyOf: jsonHash,
          identity,
        })
      const count = 1201
      for (let first = 0; first < count; first += 100) await retention.append(Array.from({ length: Math.min(100, count - first) }, (_, n) => leaf(first + n)))
      retention.seal(String(count))
      const result = await selectCompleteUsage(retention.workspace)
      await retention.flush()
      expect(result.selected).toBe(String(count))
      expect(result.excluded).toBe('0')
      expect(result.allSelectedComplete).toBe(true)
      expect(result.tokens).toEqual({
        input: '1201',
        cacheRead: '3603',
        cacheWrite: '6005',
        output: '8407',
      })
      expect(result.unknownBuckets).toEqual({
        input: '0',
        cacheRead: '0',
        cacheWrite: '0',
        output: '0',
      })
      const seen = new Set<string>()
      for await (const row of completeWorkingTraversal<{
        record: UsageContributionEvidence
        contribution: typeof tokens
      }>(snapshot.workspace, retention.allocationsNamespace)) {
        expect(row.document.contribution).toEqual(tokens)
        expect(seen.has(identity(row.document.record))).toBe(false)
        seen.add(identity(row.document.record))
      }
      expect(seen.size).toBe(count)
      for (let n = 0; n < count; n++) expect(seen.has(identity(leaf(n)))).toBe(true)
      expect(observed.points.filter((name) => name.endsWith('/ancestry')).length).toBeLessThanOrEqual(3)
      expect(observed.points.filter((name) => name.endsWith('/coverage/roots')).length).toBeLessThan(count)
      expect(observed.batches.some((batch) => batch.namespace.endsWith('/ancestry') && batch.keys > 1)).toBe(true)
      expect(observed.batches.some((batch) => batch.namespace.endsWith('/coverage/roots') && batch.keys > 1)).toBe(true)
      expect(observed.batches.every((batch) => batch.keys <= 500)).toBe(true)
    })
  }, 60000)
  test('prefetched missing roots are replaced by real same-batch summaries and keep model and unknown-bucket semantics', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async (snapshot) => {
      const retention = completeStatisticsWorkspace({
        rows: snapshot.workspace,
        namespace: 'original-partitions',
        keyOf: jsonHash,
        identity,
      })
      const root = leaf(0),
        model = { id: 'original-model-A', provider: null }
      const summary: UsageContributionEvidence = {
        ...root,
        measurement: {
          ...root.measurement,
          model,
          scope: {
            ...root.measurement.scope!,
            session: 'root',
            parentSession: null,
            ancestors: [],
            turnIndex: 1,
            level: 'tree-total',
          },
          coveredThroughTurn: 20,
        },
      }
      const child = (id: string, modelId: string | null): UsageContributionEvidence => ({
        ...leaf(2),
        measurement: {
          ...leaf(2).measurement,
          recordId: id,
          model: modelId === null ? null : { id: modelId, provider: null },
          scope: { ...leaf(2).measurement.scope!, level: 'request' },
        },
      })
      const unknown: UsageContributionEvidence = {
        ...leaf(99),
        measurement: {
          ...leaf(99).measurement,
          recordId: 'unknown-scope',
          scope: undefined,
        },
        contribution: {
          input: null,
          cacheRead: '0',
          cacheWrite: '0',
          output: '0',
        },
        complete: false,
      }
      await retention.append([
        child('same-model', 'original-model-A'),
        child('other-model', 'original-model-B'),
        child('unknown-model', null),
        unknown,
        summary,
      ])
      retention.seal('5')
      // A real unrelated original root prevents the whole-relation empty shortcut.
      await snapshot.workspace.put('original-partitions/coverage/roots', {
        key: jsonHash('unrelated'),
        document: { tree: 'unrelated', id: null },
      })
      const result = await selectCompleteUsage(retention.workspace)
      await retention.flush()
      expect(result.selected).toBe('3')
      expect(result.excluded).toBe('2')
      expect(result.ambiguousOverlaps).toBe('1')
      expect(result.unavailableSummaries).toBe('0')
      expect(result.allSelectedComplete).toBe(false)
      expect(result.tokens).toEqual({
        input: '2',
        cacheRead: '6',
        cacheWrite: '10',
        output: '14',
      })
      expect(result.unknownBuckets).toEqual({
        input: '1',
        cacheRead: '0',
        cacheWrite: '0',
        output: '0',
      })
      const records: string[] = []
      for await (const row of completeWorkingTraversal<{
        record: UsageContributionEvidence
      }>(snapshot.workspace, retention.allocationsNamespace))
        records.push(row.document.record.measurement.recordId)
      expect(records.sort()).toEqual(['original-0', 'other-model', 'unknown-scope'])
    })
  }, 30000)
  test('deep original paths cross native packets and a later input page still rejects conflicting ancestry before allocation', async () => {
    tdb = await createTestDatabase()
    const ancestors = Array.from({ length: 521 }, (_, n) => 'original-depth-' + n)
    const deep: UsageContributionEvidence = {
      ...leaf(0),
      measurement: {
        ...leaf(0).measurement,
        scope: {
          ...leaf(0).measurement.scope!,
          root: ancestors[0]!,
          session: 'deep-leaf',
          parentSession: ancestors.at(-1)!,
          ancestors,
        },
      },
    }
    const plain = Array.from({ length: 99 }, (_, n) => ({
      ...leaf(n + 1),
      measurement: { ...leaf(n + 1).measurement, scope: undefined },
    }))
    await originalReportSnapshotSession(tdb.handle).run(async (snapshot) => {
      const observed = measured(snapshot.workspace),
        retention = completeStatisticsWorkspace({
          rows: observed.rows,
          namespace: 'deep-original',
          keyOf: jsonHash,
          identity,
        })
      await retention.append([deep, ...plain])
      retention.seal('100')
      const selected = await selectCompleteUsage(retention.workspace)
      await retention.flush()
      expect(selected.selected).toBe('100')
      expect(selected.tokens).toEqual({
        input: '100',
        cacheRead: '300',
        cacheWrite: '500',
        output: '700',
      })
      expect(observed.batches.some((batch) => batch.namespace.endsWith('/ancestry') && batch.keys === 500)).toBe(true)
      const seen: string[] = []
      for await (const row of completeWorkingTraversal<{
        record: UsageContributionEvidence
      }>(snapshot.workspace, retention.allocationsNamespace))
        seen.push(identity(row.document.record))
      expect(seen.sort()).toEqual([deep, ...plain].map(identity).sort())
    })
    const conflicting: UsageContributionEvidence = {
      ...deep,
      measurement: {
        ...deep.measurement,
        recordId: 'cross-page-conflict',
        scope: {
          ...deep.measurement.scope!,
          ancestors: [...ancestors.slice(0, -1), 'changed-last-ancestor'],
          parentSession: 'changed-last-ancestor',
        },
      },
    }
    await originalReportSnapshotSession(tdb.handle).run(async (snapshot) => {
      const retention = completeStatisticsWorkspace({
        rows: snapshot.workspace,
        namespace: 'deep-conflict',
        keyOf: jsonHash,
        identity,
      })
      await retention.append([deep, ...plain, conflicting])
      retention.seal('101')
      await expect(selectCompleteUsage(retention.workspace)).rejects.toThrow('Conflicting observation session ancestry')
      expect(await snapshot.workspace.page(retention.allocationsNamespace, null, 100)).toEqual({ items: [], nextCursor: null })
    })
  }, 60000)
})
