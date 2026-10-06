import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit/index';
import { UsageRecordSchema } from '../../../packages/contracts/index';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { selectRuntimeUsage } from '../../../modules/observability/domain/tokenUsage';
import { compareCompleteUsage } from '../../../modules/observability/domain/completeUsageOrder';
import { runtimeContributionEvidence } from '../../../modules/observability/domain/completeUsageEvidence';
import { nativeScopeFixture, selectNativeScope } from './nativeScopeFixture';
const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
// RFC-034: source EOF and all original parents are required before any numerical allocation.
describe.skipIf(!available)('original paged native scopes in the complete selection workspace', () => {
  test('all 1201 actual WAL steps and 71 original parents retain every identity and exact four buckets', async () => {
    const source = await nativeScopeFixture(database);
    try {
      const selected = await selectNativeScope(database, source.records);
      expect(source.records.length).toBe(1201); expect(selected.total.selected).toBe('1201'); expect(selected.total.excluded).toBe('0');
      expect(selected.bindings).toBe('71'); expect(selected.total.allSelectedComplete).toBe(true);
      expect(selected.total.tokens).toEqual({input: '721801', cacheRead: '3603', cacheWrite: '6005', output: '3603'});
      expect(selected.allocations.map(a => a.record.original.recordId).sort()).toEqual(source.records.map(a => a.recordId).sort());
      for (const allocation of selected.allocations) expect(allocation.contribution).toEqual(allocation.record.original.projection.contribution);
      expect(() => selectRuntimeUsage(source.records)).toThrow('complete original workspace');
      const [untouched] = await database.handle.client`SELECT
        (SELECT count(*)::text FROM observability.usage_evidence) AS evidence,
        (SELECT count(*)::text FROM observability.usage_projections) AS projections,
        (SELECT count(*)::text FROM observability.execution_valuations) AS valuations`;
      expect(untouched).toEqual({evidence: '0', projections: '0', valuations: '0'});
    } finally { await source.close(); }
  }, 120_000);
  test('legacy root summaries cover every deep original child without adding parent and child buckets twice', async () => {
    const source = await nativeScopeFixture(database);
    try {
      const first = source.records[0]!, scope = first.scope!;
      const summary = UsageRecordSchema.parse({...first, recordId: 'fixture-original-root-summary', inclusion: 'includes-descendants',
        scope: {root: scope.root, session: scope.root, parentSession: null, ancestors: [], turn: scope.turn, turnIndex: scope.turnIndex, level: 'tree-total'},
        coveredThroughTurn: scope.turnIndex, usage: {input: '721801', cacheRead: '3603', cacheWrite: '6005', output: '3603'},
        projection: {...first.projection, contribution: {input: '721801', cacheRead: '3603', cacheWrite: '6005', output: '3603'}}});
      const selected = await selectNativeScope(database, [...source.records, summary]);
      expect(selected.total.selected).toBe('1'); expect(selected.total.excluded).toBe('1201');
      expect<Readonly<Record<string, string | null>>>(selected.total.tokens).toEqual(summary.usage); expect(selected.total.allSelectedComplete).toBe(true);
      expect(selected.allocations[0]!.record.original.recordId).toBe(summary.recordId);
    } finally { await source.close(); }
  }, 120_000);
  test('legacy and native intermediate paths conflict before any allocation, regardless of source order', async () => {
    const source = await nativeScopeFixture(database, 1);
    try {
      const first = source.records[0]!, scope = first.scope!;
      const conflicting = UsageRecordSchema.parse({...first, recordId: 'fixture-conflicting-original-prefix',
        scope: {root: scope.root, session: 'fixture-session-0003', parentSession: 'fixture-conflicting-parent',
          ancestors: [scope.root, 'fixture-conflicting-parent'], turn: scope.turn, turnIndex: scope.turnIndex, level: 'request'}});
      await expect(selectNativeScope(database, [first, conflicting])).rejects.toThrow('Conflicting observation session ancestry');
      await expect(selectNativeScope(database, [conflicting, first])).rejects.toThrow('Conflicting observation session ancestry');
    } finally { await source.close(); }
  }, 60_000);
  test('a raw source still receiving packets never becomes a qualified numerical population', async () => {
    const source = await nativeScopeFixture(database, 1201, 70, false);
    try { await expect(selectNativeScope(database, source.records)).rejects.toThrow('完整 EOF'); }
    finally { await source.close(); }
  }, 60_000);
  test('actual 5206-parent population survives native reference cache eviction and reaches its original root', async () => {
    const source = await nativeScopeFixture(database, 1, 5205);
    try {
      const selected = await selectNativeScope(database, source.records);
      expect(selected.total.selected).toBe('1'); expect(selected.bindings).toBe('5206');
      expect(selected.total.tokens).toEqual({input: '1', cacheRead: '3', cacheWrite: '5', output: '3'});
      expect(selected.total.allSelectedComplete).toBe(true);
    } finally { await source.close(); }
  }, 300_000);
  test('native decimal depths retain adjacent order beyond Number precision', async () => {
    const source = await nativeScopeFixture(database, 1);
    try {
      const a = structuredClone(source.records[0]!), b = structuredClone(a);
      if (!a.scope || !b.scope || !('native' in a.scope) || !('native' in b.scope)) throw new Error('Original paged scope missing');
      a.scope.native.depth = '9007199254740992'; b.scope.native.depth = '9007199254740993';
      expect(compareCompleteUsage(runtimeContributionEvidence(a), runtimeContributionEvidence(b))).toBe(-1);
      expect(compareCompleteUsage(runtimeContributionEvidence(b), runtimeContributionEvidence(a))).toBe(1);
    } finally { await source.close(); }
  }, 60_000);
});
