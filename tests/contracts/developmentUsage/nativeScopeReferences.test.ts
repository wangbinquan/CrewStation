import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { UsageRecord } from '../../../packages/contracts/index';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit/index';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { nativeScopeFixture, selectNativeScope } from './nativeScopeFixture';
const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
type Scope = Extract<NonNullable<UsageRecord['scope']>, {native: unknown}>;
// RFC-034: qualified native ranges must retain their real pass, page, source and parent references.
describe.skipIf(!available)('original native scope reference qualification', () => {
  test('changed final identity, owner, page, digest, namespace, parent and depth fail on the same original snapshot', async () => {
    const source = await nativeScopeFixture(database, 1);
    try {
      const mutations: Array<(scope: Scope) => void> = [
        s => {s.native.passKey = 'e'.repeat(64);}, s => {s.native.identity.passId = 'fixture-other-pass';},
        s => {s.native.ownerReceiptId = 'fixture-other-owner';}, s => {s.native.pageOrdinal = '9999';},
        s => {s.native.cumulativeDigest = 'e'.repeat(64);}, s => {s.native.sourceNamespace = 'e'.repeat(64);},
        s => {s.native.pathDigest = 'e'.repeat(64);}, s => {s.native.depth = '71';},
        s => {s.parentSession = 'fixture-other-parent';}, s => {s.turnIndex++;},
      ];
      for (const mutate of mutations) {
        const record = structuredClone(source.records[0]!);
        if (!record.scope || !('native' in record.scope)) throw new Error('Original scope missing');
        mutate(record.scope);
        await expect(selectNativeScope(database, [record])).rejects.toThrow();
      }
      const wrong = structuredClone(source.records[0]!); wrong.sourceId = 'fixture-other-original-source';
      await expect(selectNativeScope(database, [wrong])).rejects.toThrow('原执行与原来源');
    } finally { await source.close(); }
  }, 120_000);
  test('a missing original parent row is detected across the complete population before allocation', async () => {
    const source = await nativeScopeFixture(database, 1);
    try {
      const scope = source.records[0]!.scope;
      if (!scope || !('native' in scope)) throw new Error('Original scope missing');
      await database.handle.client`DELETE FROM observability.development_native_paths WHERE pass_key=${scope.native.passKey} AND session_id='fixture-session-0003'`;
      await expect(selectNativeScope(database, source.records)).rejects.toThrow('真实 EOF 人口');
    } finally { await source.close(); }
  }, 60_000);
});
