// RFC-034 N5: actual platform/Session factories and retained pages after ACK, not the manual N2 fixture copy.
import { afterEach, describe, expect, test } from 'bun:test';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit';
import { sessionMigrations } from '../../../modules/session/wiring';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { nativeLiveFixture } from './nativeLiveFixture';
import type { UsageRecord } from '../../../packages/contracts';

const available = await testDatabaseAvailable(); let database: TestDatabase;
afterEach(async () => { await database?.drop(); });
const create = async () => { database = await createTestDatabase([sessionMigrations, observabilityMigrations]); return database; };
describe.skipIf(!available)('actual native v2 live consumer and durable ordinary ACK recovery', () => {
  test('original Session pages survive ordinary ACK and a failed numeric read; a reopened real module completes the same ledger and original CNY fee', async () => {
    const f = await nativeLiveFixture(await create(), { failAfterAck: true });
    try {
      f.populate(1, 0); await f.execution.persist('final'); await f.execution.copySession();
      const promise = f.module.api.reconcileExecutionUsage(); expect(f.module.api.reconcileExecutionUsage()).toBe(promise); expect(await promise).toBe(1);
      expect(await f.session.api.nextDevelopmentUsageSource()).toBeUndefined();
      expect(await database.handle.client`SELECT document FROM observability.usage_projections`).toHaveLength(0);
      const [pass] = await database.handle.client`SELECT pass_key,work_state,progress FROM observability.development_native_passes`;
      expect(pass).toMatchObject({ work_state: 'pending', progress: { eof: true, counts: { sessions: '1', parts: '1', steps: '1' } } });
      expect(f.reads.some(read => read.afterAck)).toBe(true);
      f.allowRecoveredWork(); expect(await f.reopen().api.reconcileExecutionUsage()).toBe(1);
      const [usage] = await database.handle.client`SELECT document FROM observability.usage_projections`;
      expect(usage!.document).toMatchObject({ identity: f.execution.registration.identity, projection: { contribution: { input: '1', cacheRead: '3', cacheWrite: '5', output: '3' } } });
      const [value] = await database.handle.client`SELECT document FROM observability.execution_valuations`;
      expect(value!.document).toMatchObject({ currency: 'CNY', amountDecimal: '0.0000425', priceVersionRef: f.price.original.id });
      const [retained] = await database.handle.client`SELECT document FROM observability.development_native_work WHERE pass_key=${pass!.pass_key}`;
      expect(retained!.document).toMatchObject({ visited: '1', held: '0', numericEof: true, valuationEof: true });
      expect(await f.reopen().api.reconcileExecutionUsage()).toBe(0);
    } finally { await f.close(); }
  });
  test('twenty ordinary scheduling pages are not a population cap; every original page and all 211 steps reach numeric and valuation EOF', async () => {
    const f = await nativeLiveFixture(await create());
    try {
      f.populate(211, 0); await f.execution.persist('final', 1); await f.execution.copySession();
      expect(await f.module.api.reconcileExecutionUsage()).toBe(20);
      expect(await f.session.api.nextDevelopmentUsageSource()).toBeDefined();
      const module = f.reopen();
      for (;;) {
        await module.api.reconcileExecutionUsage();
        const [state] = await database.handle.client`SELECT work_state FROM observability.development_native_passes`;
        if (state!.work_state === 'processed') break;
      }
      expect(await f.session.api.nextDevelopmentUsageSource()).toBeUndefined();
      const usage = await database.handle.client`SELECT document FROM observability.usage_projections`;
      const values = await database.handle.client`SELECT document FROM observability.execution_valuations`;
      expect(usage).toHaveLength(211); expect(values).toHaveLength(211);
      const sum = (bucket: keyof UsageRecord['usage']) => usage.reduce((total, row) => total + BigInt((row.document as UsageRecord).projection.contribution[bucket]!), 0n).toString();
      expect({ input: sum('input'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), output: sum('output') })
        .toEqual({ input: '22366', cacheRead: '633', cacheWrite: '1055', output: '633' });
      expect(values.every(row => row.document.currency === 'CNY' && row.document.priceVersionRef === f.price.original.id)).toBe(true);
      const [retained] = await database.handle.client`SELECT document FROM observability.development_native_work`;
      expect(retained!.document).toMatchObject({ visited: '211', held: '0', numericEof: true, valuationEof: true });
      const pages = await database.handle.client`SELECT ordinal FROM observability.development_native_pages`;
      expect(pages.length).toBeGreaterThan(100); expect(new Set(pages.map(row => row.ordinal)).size).toBe(pages.length);
    } finally { await f.close(); }
  }, 60_000);
  test('a v2 source without the actual Session page port retains the complete ordinary source and performs no projection or ACK', async () => {
    const f = await nativeLiveFixture(await create(), { missingOriginalPort: true });
    try {
      f.populate(1, 0); await f.execution.persist('final'); await f.execution.copySession();
      expect(await f.module.api.reconcileExecutionUsage()).toBe(0);
      expect(await f.session.api.nextDevelopmentUsageSource()).toMatchObject({ key: f.execution.registration.key, after: 0 });
      expect(await database.handle.client`SELECT pass_key FROM observability.development_native_passes`).toHaveLength(0);
      expect(await database.handle.client`SELECT document FROM observability.usage_projections`).toHaveLength(0);
    } finally { await f.close(); }
  });
  test('an independently stored Session Pod or frozen namespace mismatch cannot commit or ACK a native original page', async () => {
    const f = await nativeLiveFixture(await create());
    try {
      f.populate(1, 0); await f.execution.persist('final'); await f.execution.copySession();
      const original = f.owner();
      for (const owner of [{ ...original, registration: { ...original.registration, podUid: 'different-owner-pod' } },
        { ...original, nativeSelection: { version: 2 as const, expectedNamespace: 'other-frozen-namespace' } }]) {
        f.replaceOwner(owner); expect(await f.module.api.reconcileExecutionUsage()).toBe(0);
        expect(await f.session.api.nextDevelopmentUsageSource()).toMatchObject({ key: f.execution.registration.key, after: 0 });
        expect(await database.handle.client`SELECT pass_key FROM observability.development_native_passes`).toHaveLength(0);
      }
      f.replaceOwner(original); expect(await f.reopen().api.reconcileExecutionUsage()).toBe(2);
    } finally { await f.close(); }
  });
});
