import { afterEach, describe, expect, test } from 'bun:test'
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit'
import { jsonHash } from '@crewstation/kernel'
import { originalReportSnapshotSession } from '@crewstation/persistence'
import { completeCoverageWorkspace } from '../../../adapters/persistence/completeCoverageWorkspace'
import { coveragePrefixMaximum, insertCoverageInterval } from '../../../domain/coverageIntervalIndex'
import { treeKey, modelPartition } from '../../../domain/complete-usage/coverageKeys'
import { packedCoverageTree, type PackedCoverageRoots } from '../../../adapters/persistence/completeCoverage/rootDocuments'

const available = await testDatabaseAvailable()
let tdb: TestDatabase
afterEach(async () => { await tdb?.drop() })

describe.skipIf(!available)('actual original packed root identity and legacy retention', () => {
  test('a retained canonical legacy bucket keeps its original format and cannot gain a second packed version', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const namespace = 'actual-canonical-legacy', legacy = treeKey('group', 'output', 'session', false, 'all'), packed = treeKey('group', 'cacheRead', 'session', false, 'all')
      await snapshot.workspace.put(namespace + '/roots', { key: jsonHash(legacy), document: { tree: legacy, id: '41', point: [3, 8] } })
      const writer = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      await insertCoverageInterval(writer.coverage, legacy, { start: 3, end: 15 })
      await insertCoverageInterval(writer.coverage, packed, { start: 20, end: 25 }); await writer.flush()
      const original = await snapshot.workspace.get(namespace + '/roots', jsonHash(legacy))
      expect(original).toEqual({ tree: legacy, id: '41' })
      const legacyNodes = await snapshot.workspace.page<{ start: number; end: number }>(namespace + '/nodes', null, 100)
      expect(legacyNodes.nextCursor).toBeNull(); expect(legacyNodes.items.map(row => [row.document.start, row.document.end]).sort((a, b) => a[1]! - b[1]!)).toEqual([[3, 8], [3, 15]])
      const address = jsonHash(packedCoverageTree(packed)!.address), document = await snapshot.workspace.get<PackedCoverageRoots>(namespace + '/packed-roots', address)
      expect(Object.keys(document!.slots)).toEqual(['cacheRead'])
      const reader = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      expect(await coveragePrefixMaximum(reader.coverage, legacy, 3)).toBe(15)
      expect(await coveragePrefixMaximum(reader.coverage, packed, 20)).toBe(25)
      await snapshot.workspace.put(namespace + '/packed-roots', { key: address, document: { ...document!, slots: { ...document!.slots, output: { id: 'duplicate-node', point: [3, 15] } } } })
      const duplicate = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      await expect(duplicate.coverage.root(legacy)).rejects.toThrow('duplicate physical identities')
    })
  }, 30000)

  test('changed original identities, foreign slots and damaged points reject before a maximum can be published', async () => {
    tdb = await createTestDatabase()
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const namespace = 'actual-packed-integrity', tree = treeKey('actual-group', 'input', 'actual-session', true, modelPartition('actual-model', 'actual-provider'))
      const writer = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      await insertCoverageInterval(writer.coverage, tree, { start: 3, end: 5 }); await writer.flush()
      const key = jsonHash(packedCoverageTree(tree)!.address), original = (await snapshot.workspace.get<PackedCoverageRoots>(namespace + '/packed-roots', key))!
      const corruptions = [
        { ...original, common: [original.common[0], original.common[1], false, original.common[3]] },
        { ...original, common: [original.common[0], original.common[1], true, modelPartition('actual-model', null)] },
        { ...original, slots: { ...original.slots, foreignBucket: { id: 'foreign-node' } } },
        { ...original, slots: { input: { id: '1', point: [3, 'unknown'] } } },
        { ...original, slots: { input: { id: '1', point: [3] } } },
        { ...original, slots: { input: { id: null, point: [3, 5] } } },
        { ...original, extraIdentity: 'foreign' },
      ]
      for (const document of corruptions) {
        await snapshot.workspace.put(namespace + '/packed-roots', { key, document })
        const reader = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
        await expect(coveragePrefixMaximum(reader.coverage, tree, 3)).rejects.toThrow('Coverage')
      }
      await snapshot.workspace.put(namespace + '/packed-roots', { key, document: original })
      const restored = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash)
      expect(await coveragePrefixMaximum(restored.coverage, tree, 3)).toBe(5)
      const collision = completeCoverageWorkspace(snapshot.workspace, 'actual-hash-collision', () => 'same-hash')
      await collision.coverage.setRoot(tree, 'original-input')
      await expect(collision.coverage.setRoot(treeKey('other-group', 'input', 'actual-session', true, 'all'), 'other-input')).rejects.toThrow('identity conflict')
    })
  }, 30000)
})
