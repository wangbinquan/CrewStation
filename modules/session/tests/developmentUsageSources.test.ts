// RFC-034: fixed offered boundaries and original journal keys survive consumer failure and process restart.
import { afterEach, describe, expect, test } from 'bun:test';
import type { RunnerUsageCapture } from '@crewstation/contracts';
import { DEVELOPMENT_USAGE_LIMITS } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleDevelopmentUsageStore } from '../adapters/persistence/developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../adapters/persistence/developmentUsageSources';
import { sessionMigrations } from '../wiring';
import { developmentCapture, developmentPage, developmentReceipt, developmentRegistration } from './developmentUsageFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development fair bounded numeric outbox', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  const setup = async () => { tdb = await createTestDatabase([sessionMigrations]); return { store: drizzleDevelopmentUsageStore(tdb.db), source: drizzleDevelopmentUsageSourceStore(tdb.db) }; };

  test('lost consumer ACK replays the identical page while other executions rotate fairly', async () => {
    const { store, source } = await setup(), first = developmentRegistration(), second = developmentRegistration();
    for (const r of [first, second]) {
      await store.register(r); await store.ingest(r.runtimeTaskId, developmentReceipt(r, 6), developmentPage(r, 0, 5)); await store.ingest(r.runtimeTaskId, developmentReceipt(r, 6), developmentPage(r, 5, 1));
    }
    const page = (await source.next())!; expect(page).toEqual(developmentPage(first, 0, 5));
    const other = (await source.next())!; expect(other).toEqual(developmentPage(second, 0, 5));
    expect(await drizzleDevelopmentUsageSourceStore(tdb.db).next()).toEqual(page);
    await expect(source.acknowledge(first.key, 6)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(source.acknowledge(first.key, 3)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(source.acknowledge({ ...first.key, journalId: crypto.randomUUID() }, 5)).rejects.toMatchObject({ kind: 'conflict' });
    await source.acknowledge(first.key, 5); await source.acknowledge(first.key, 5); await source.acknowledge(first.key, 4);
    expect(await source.next()).toEqual(other);
    await source.acknowledge(second.key, 5);
    const tail1 = (await source.next())!, tail2 = (await source.next())!;
    expect([tail1.key.executionId, tail2.key.executionId].sort()).toEqual([first.key.executionId, second.key.executionId].sort());
    for (const tail of [tail1, tail2]) { expect(tail.after).toBe(5); expect(tail.through).toBe(6); await source.acknowledge(tail.key, 6); }
    expect(await source.next()).toBeUndefined();
    await expect(source.acknowledge(first.key, -1)).rejects.toMatchObject({ kind: 'validation' });
    await expect(source.acknowledge(developmentRegistration().key, 0)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('new captures do not extend an offered page and source consumption never deletes original model evidence', async () => {
    const { store, source } = await setup(), r = developmentRegistration(); await store.register(r);
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 1), developmentPage(r, 0, 1));
    const first = (await source.next())!;
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 2), developmentPage(r, 1, 1));
    expect(await drizzleDevelopmentUsageSourceStore(tdb.db).next()).toEqual(first);
    await source.acknowledge(r.key, 1); expect(await source.next()).toEqual(developmentPage(r, 1, 1));
    await source.acknowledge(r.key, 2); expect(await source.next()).toBeUndefined();
    expect(await source.measurement(r.key, 'step-1', 1)).toEqual(developmentCapture(1).measurements[0]);
    expect((await store.get(r.runtimeTaskId, r.key))?.persistedThrough).toBe(2);
    await store.unavailable(r.runtimeTaskId, { key: r.key, podUid: r.podUid, reason: 'forced-release' }); await store.requestDrain(r.runtimeTaskId, r.key, 'forced-release');
    expect(await source.measurement(r.key, 'step-2', 2)).toEqual(developmentCapture(2).measurements[0]);
  });

  test('same native revision with conflicting actual models remains an explicit valuation conflict', async () => {
    const { store, source } = await setup(), r = developmentRegistration(); await store.register(r);
    const page = developmentPage(r, 0, 2), original = developmentCapture(1);
    page.events[0]!.capture = original;
    page.events[1]!.capture = { ...original, measurements: original.measurements.map((m) => ({ ...m, actualModel: { provider: 'other', model: 'different', condition: null } })) };
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 2), page);
    await expect(source.measurement(r.key, 'step-1', 1)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await source.next()).toEqual(page);
  });

  test('byte bounds split large valid captures without truncating numeric records or changing replay', async () => {
    const { store, source } = await setup(), r = developmentRegistration(); await store.register(r);
    const ancestors = Array.from({ length: 12 }, (_, i) => String(i).padEnd(512, 'x'));
    const capture: RunnerUsageCapture = { version: 1, diagnostics: [], measurements: Array.from({ length: 100 }, (_, i) => ({ ...developmentCapture(1).measurements[0]!, recordId: 'large-' + i,
      scope: { root: ancestors[0]!, session: 'leaf'.padEnd(512, 'x'), parentSession: ancestors.at(-1)!, ancestors, turn: 'turn', turnIndex: 0, level: 'request' } })) };
    for (let after = 0; after < 2; after++) { const page = developmentPage(r, after, 1); page.events[0]!.capture = capture; await store.ingest(r.runtimeTaskId, developmentReceipt(r, after + 1), page); }
    const first = (await source.next())!; expect(first.after).toBe(0); expect(first.through).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(DEVELOPMENT_USAGE_LIMITS.pageBytes);
    expect(first.events[0]!.capture.measurements).toHaveLength(100);
    expect(await drizzleDevelopmentUsageSourceStore(tdb.db).next()).toEqual(first);
    await source.acknowledge(r.key, 1); const tail = (await source.next())!; expect(tail.after).toBe(1); expect(tail.through).toBe(2);
    await source.acknowledge(r.key, 2); expect(await source.next()).toBeUndefined();
  });

  test('polling a pending execution rotates past failures and cannot select another environment', async () => {
    const { store } = await setup(), first = developmentRegistration(), second = developmentRegistration();
    await store.register(first); await store.register(second);
    expect((await store.pending([first.runtimeTaskId, second.runtimeTaskId], 1))[0]?.registration).toEqual(first);
    expect((await store.pending([first.runtimeTaskId, second.runtimeTaskId], 1))[0]?.registration).toEqual(second);
    expect(await store.pending([developmentRegistration().runtimeTaskId], 1)).toEqual([]);
  });
});
