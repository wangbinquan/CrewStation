import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { jsonHash } from '@crewstation/kernel';
import { originalReportSnapshotSession } from '@crewstation/persistence';
import { completeCoverageWorkspace } from '../../adapters/persistence/completeCoverageWorkspace';
import { coveragePrefixMaximum, insertCoverageInterval } from '../../domain/coverageIntervalIndex';
import type { CompleteWorkingPage } from '../../ports/completeWorkingRows';

const available = await testDatabaseAvailable(); let tdb: TestDatabase;
afterEach(async () => { await tdb?.drop(); });
describe.skipIf(!available)('exact original single-interval TEMP retention', () => {
  test('5205 original trees survive cache eviction and reopen to actual TEMP EOF without duplicate node rows', async () => {
    tdb = await createTestDatabase();
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const namespace = 'original-point-population', original = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash);
      for (let first = 0; first < 5205; first += 100) {
        const ids = Array.from({ length: Math.min(100, 5205 - first) }, (_, i) => first + i);
        await original.prefetchRoots(ids.map(id => 'original-tree-' + id));
        for (const id of ids) await insertCoverageInterval(original.coverage, 'original-tree-' + id, { start: id, end: id + 5 });
      }
      await original.flush();
      const counts = await snapshot.executor.execute<{ namespace: string; count: string }>(sql`SELECT namespace,count(*)::text AS count
        FROM pg_temp.cs_report_workspace GROUP BY namespace ORDER BY namespace`);
      expect([...counts]).toEqual([{ namespace: namespace + '/roots', count: '5205' }]);
      let cursor: string | null = null, received = 0;
      for (;;) {
        const page: CompleteWorkingPage<{ tree: string; id: string; point: [number, number] }> = await snapshot.workspace.page<{ tree: string; id: string; point: [number, number] }>(namespace + '/roots', cursor, 137);
        for (const row of page.items) {
          const id = Number(row.document.tree.slice('original-tree-'.length));
          expect(row.key).toBe(jsonHash(row.document.tree)); expect(row.document.point).toEqual([id, id + 5]);
          expect(row.document.id).toBe(String(id + 1)); received++;
        }
        if (page.nextCursor === null) break; cursor = page.nextCursor;
      }
      expect(received).toBe(5205);
      const reopened = completeCoverageWorkspace(snapshot.workspace, namespace, jsonHash);
      for (const id of [0, 499, 500, 4095, 4096, 5204]) {
        expect(await coveragePrefixMaximum(reopened.coverage, 'original-tree-' + id, id - 1)).toBeNull();
        expect(await coveragePrefixMaximum(reopened.coverage, 'original-tree-' + id, id)).toBe(id + 5);
      }
    });
  }, 30000);
  test('growth and both rotations spill the original interval, preserving each prefix maximum after every actual flush', async () => {
    tdb = await createTestDatabase();
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      for (const [tree, starts] of [['left-to-right', [10, 30, 50, 2, 9]], ['right-to-left', [50, 30, 10, 60, 51]]] as const) {
        const workspace = completeCoverageWorkspace(snapshot.workspace, tree, jsonHash);
        const intervals: { start: number; end: number }[] = [];
        for (const start of starts) {
          intervals.push({ start, end: start + (start === 9 ? 91 : 5) });
          await insertCoverageInterval(workspace.coverage, tree, intervals.at(-1)!); await workspace.flush();
          const reader = completeCoverageWorkspace(snapshot.workspace, tree, jsonHash);
          for (let bound = 0; bound <= 105; bound += 3) {
            const ends = intervals.filter(interval => interval.start <= bound).map(interval => interval.end);
            expect(await coveragePrefixMaximum(reader.coverage, tree, bound)).toBe(ends.length ? Math.max(...ends) : null);
          }
        }
        const root = await snapshot.workspace.get<{ tree: string; point?: unknown }>(tree + '/roots', jsonHash(tree));
        expect(root?.tree).toBe(tree); expect(root?.point).toBeUndefined();
        const nodes = await snapshot.workspace.page(tree + '/nodes', null, 100);
        expect(nodes.items).toHaveLength(starts.length); expect(nodes.nextCursor).toBeNull();
      }
    });
  }, 30000);
  test('a changed original compact point fails instead of returning a fabricated maximum', async () => {
    tdb = await createTestDatabase();
    await originalReportSnapshotSession(tdb.handle).run(async snapshot => {
      const original = completeCoverageWorkspace(snapshot.workspace, 'changed-point', jsonHash);
      await insertCoverageInterval(original.coverage, 'tree', { start: 3, end: 5 }); await original.flush();
      for (const point of [[3, 'unknown'], [3]]) {
        await snapshot.workspace.put('changed-point/roots', { key: jsonHash('tree'), document: { tree: 'tree', id: '1', point } });
        const reopened = completeCoverageWorkspace(snapshot.workspace, 'changed-point', jsonHash);
        await expect(coveragePrefixMaximum(reopened.coverage, 'tree', 3)).rejects.toThrow('Coverage point interval invalid');
      }
    });
  });
  // RFC-034: 原499节点刷新边界曾把新树的第一叶重复持久化，导致 TEMP 膨胀。
  test('499 retained full nodes cannot flush a new first leaf before its original root is set', async () => {
    tdb = await createTestDatabase();
    await originalReportSnapshotSession(tdb.handle).run(async ({ workspace: rows }) => {
      const namespace = 'mixed-original-trees',
        workspace = completeCoverageWorkspace(rows, namespace, jsonHash)
      for (let start = 0; start < 499; start++)
        await insertCoverageInterval(workspace.coverage, 'retained-tree', { start, end: start + 1 })
      await insertCoverageInterval(workspace.coverage, 'new-tree', { start: 1000, end: 1005 })
      await workspace.flush()
      const retained = new Set<string>()
      let cursor: string | null = null
      for (;;) {
        const page: CompleteWorkingPage<{ id: string }> = await rows.page(
          namespace + '/nodes',
          cursor,
          137,
        )
        for (const row of page.items) {
          expect(row.key).toBe(jsonHash(JSON.stringify(['retained-tree', row.document.id])))
          expect(retained.has(row.document.id)).toBe(false)
          retained.add(row.document.id)
        }
        if (page.nextCursor === null) break
        cursor = page.nextCursor
      }
      expect(retained.size).toBe(499)
      expect([...retained].map(Number).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 499 }, (_, i) => i + 1),
      )
      expect(await rows.get<{ tree: string; id: string; point: readonly [number, number] }>(namespace + '/roots', jsonHash('new-tree'))).toEqual({
        tree: 'new-tree',
        id: '500',
        point: [1000, 1005],
      })
      const reader = completeCoverageWorkspace(rows, namespace, jsonHash)
      for (const bound of [0, 100, 300, 498, 499])
        expect(await coveragePrefixMaximum(reader.coverage, 'retained-tree', bound)).toBe(
          Math.min(bound + 1, 499),
        )
      expect(await coveragePrefixMaximum(reader.coverage, 'new-tree', 1000)).toBe(1005)
    })
  }, 30000)
  // RFC-034: point 存储不得拒绝原 AVL 已接受的 safe-integer 端点对。
  test('compact retention preserves every original safe-integer endpoint pair accepted by the AVL API', async () => {
    tdb = await createTestDatabase();
    await originalReportSnapshotSession(tdb.handle).run(async ({ workspace: rows }) => {
      const workspace = completeCoverageWorkspace(rows, 'original-reversed-pair', jsonHash)
      await insertCoverageInterval(workspace.coverage, 'tree', { start: 5, end: 2 })
      await workspace.flush()
      const reader = completeCoverageWorkspace(rows, 'original-reversed-pair', jsonHash)
      expect(await coveragePrefixMaximum(reader.coverage, 'tree', 4)).toBeNull()
      expect(await coveragePrefixMaximum(reader.coverage, 'tree', 5)).toBe(2)
      expect(await coveragePrefixMaximum(reader.coverage, 'tree', 6)).toBe(2)
      expect(await rows.get<{ tree: string; id: string; point: readonly [number, number] }>('original-reversed-pair/roots', jsonHash('tree'))).toEqual({
        tree: 'tree',
        id: '1',
        point: [5, 2],
      })
    })
  }, 30000)
});
