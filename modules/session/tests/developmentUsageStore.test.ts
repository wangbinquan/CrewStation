// RFC-034: real PG copies and outbox boundaries; no provider calls, cluster tasks or identity changes.
import { afterEach, describe, expect, test } from 'bun:test';
import { DevelopmentUsageLossSchema } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleDevelopmentUsageStore } from '../adapters/persistence/developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../adapters/persistence/developmentUsageSources';
import { sessionMigrations } from '../wiring';
import { developmentCapture, developmentPage, developmentReceipt, developmentRegistration } from './developmentUsageFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development original-key PG copy and cleanup barrier', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  const setup = async () => { tdb = await createTestDatabase([sessionMigrations]); const registration = developmentRegistration(), store = drizzleDevelopmentUsageStore(tdb.db), source = drizzleDevelopmentUsageSourceStore(tdb.db); await store.register(registration); return { registration, store, source, task: registration.runtimeTaskId, key: registration.key }; };

  test('registration precedes acceptance and concurrent replay cannot adopt another journal, Pod or owner', async () => {
    const { registration: r, store, task, key } = await setup();
    const registered = await store.get(task, key); expect(registered).toMatchObject({ receipt: null, persistedThrough: 0, complete: false, closure: null });
    const replay = await Promise.all(Array.from({ length: 4 }, () => store.register(r))); expect(replay.every((row) => row.receipt === null)).toBe(true);
    for (const changed of [{ ...r, key: { ...key, journalId: crypto.randomUUID() } }, { ...r, podUid: 'different-pod' }, { ...r, profileRevision: 4 }, { ...r, identity: { ...r.identity, agentId: developmentRegistration().identity.agentId } }]) await expect(store.register(changed)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await store.get(task, key)).toEqual(registered);
    await expect(store.get(task, { ...key, incarnation: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await store.get(developmentRegistration().runtimeTaskId, key)).toBeUndefined();
    await expect(store.register({ ...r, runtimeTaskId: developmentRegistration().runtimeTaskId })).rejects.toThrow();
  });

  test('out-of-order numeric pages wait for continuous copy; conflict rolls back all newly appended evidence', async () => {
    const { registration: r, store, source, task, key } = await setup(), receipt = developmentReceipt(r, 2);
    await store.ingest(task, receipt, developmentPage(r, 1, 1));
    expect((await store.get(task, key))?.persistedThrough).toBe(0); expect(await source.next()).toBeUndefined();
    expect(await source.measurement(key, 'step-2', 2)).toBeUndefined();
    await Promise.all(Array.from({ length: 4 }, () => store.ingest(task, receipt, developmentPage(r, 0, 2))));
    expect(await store.get(task, key)).toMatchObject({ persistedThrough: 2, complete: false });
    expect(await tdb.db.execute(sql`SELECT sequence FROM session.development_usage_events`)).toHaveLength(2);
    const bad = developmentPage(r, 0, 3); bad.events[0]!.capture.diagnostics = ['changed'];
    await expect(store.ingest(task, developmentReceipt(r, 3), bad)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await tdb.db.execute(sql`SELECT sequence FROM session.development_usage_events`)).toHaveLength(2);
    expect((await store.get(task, key))?.receipt?.lastSequence).toBe(2);
    expect(await source.measurement(key, 'step-2', 2)).toEqual(developmentCapture(2).measurements[0]);
    expect(await source.measurement({ ...key, payloadDigest: 'b'.repeat(64) }, 'step-2', 2)).toBeUndefined();
    await expect(source.measurement(key, 'step-2', 0)).rejects.toMatchObject({ kind: 'validation' });
  });

  test('finished N does not complete copied M and every readable interrupted tail is copied before cleanup', async () => {
    const { registration: r, store, task, key } = await setup();
    const receipt = developmentReceipt(r, 10, { phase: 'finished', result: 'completed', interruption: 'journal-unavailable' });
    await store.ingest(task, receipt, developmentPage(r, 0, 5)); await store.ingest(task, receipt, developmentPage(r, 5, 3));
    expect(await store.requestDrain(task, key, 'completed')).toMatchObject({ persistedThrough: 8, receipt: { lastSequence: 10 }, closure: null });
    await expect(store.acknowledgeRunner(task, key, 10)).rejects.toMatchObject({ kind: 'conflict' });
    expect(await store.ingest(task, receipt, developmentPage(r, 8, 2))).toMatchObject({ persistedThrough: 10, complete: false, closure: { status: 'interrupted', persistedThrough: 10, reportedThrough: 10, missingAfter: null, tailUnknown: true } });
    await store.acknowledgeRunner(task, key, 10); await store.acknowledgeRunner(task, key, 9);
    expect((await store.get(task, key))?.runnerAcknowledgedThrough).toBe(10);
    expect(await store.pending([task], 20)).toEqual([]);
  });

  test('bound irretrievable loss preserves actual M and known gap; numeric interruption cannot end a live model', async () => {
    const { registration: r, store, source, task, key } = await setup();
    const receipt = developmentReceipt(r, 10, { interruption: 'journal-corrupt' });
    await store.ingest(task, receipt, developmentPage(r, 0, 5)); await store.ingest(task, receipt, developmentPage(r, 5, 3));
    const loss = { key, podUid: r.podUid, reason: 'journal-corrupt' as const };
    await expect(store.unavailable(task, { ...loss, podUid: 'not-original-pod' })).rejects.toMatchObject({ kind: 'conflict' });
    expect(DevelopmentUsageLossSchema.safeParse({ ...loss, reason: 'timeout' }).success).toBe(false);
    expect(await store.unavailable(task, loss)).toMatchObject({ persistedThrough: 8, closure: null });
    expect(await store.requestDrain(task, key, 'cancelled')).toMatchObject({ complete: false, closure: { status: 'interrupted', persistedThrough: 8, reportedThrough: 10, missingAfter: 8, missingThrough: 10, tailUnknown: true } });
    expect(await drizzleDevelopmentUsageStore(tdb.db).get(task, key)).toEqual(await store.get(task, key));
    await expect(store.ingest(task, receipt, developmentPage(r, 8, 2))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.unavailable(task, { ...loss, reason: 'pod-lost' })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await source.next())?.through).toBe(5); expect(await store.pending([task], 20)).toEqual([]);
  });

  test('healthy final zero is a transport receipt, not fake measured zero; stale status cannot regress durable completion', async () => {
    const { registration: r, store, source, task, key } = await setup();
    const final = developmentReceipt(r, 0, { phase: 'finished', result: 'completed', finalThrough: 0 });
    expect(await store.ingest(task, final)).toMatchObject({ complete: true, closure: null });
    expect(await source.next()).toBeUndefined();
    await store.ingest(task, developmentReceipt(r));
    expect(await store.requestDrain(task, key, 'completed')).toMatchObject({ receipt: { phase: 'finished', finalThrough: 0 }, closure: { status: 'complete', tailUnknown: false } });
    await store.unavailable(task, { key, podUid: r.podUid, reason: 'pod-lost' });
    expect((await store.get(task, key))?.closure?.status).toBe('complete');
    await expect(store.acknowledgeRunner(task, key, -1)).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('terminal result, frozen interrupted N, header, page key and receipt ACK never admit conflicting content', async () => {
    const { registration: r, store, task, key } = await setup();
    const final = developmentReceipt(r, 1, { phase: 'finished', result: 'completed', finalThrough: 1 });
    await store.ingest(task, final, developmentPage(r, 0, 1));
    await expect(store.ingest(task, { ...final, result: 'error' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.ingest(task, developmentReceipt(r, 2), developmentPage(r, 1, 1))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.ingest(task, { ...final, profileRevision: 4 })).rejects.toMatchObject({ kind: 'conflict' });
    const second = developmentRegistration(); await store.register(second);
    await expect(store.ingest(second.runtimeTaskId, developmentReceipt(second, 1, { acknowledgedSequence: 1 }))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.ingest(second.runtimeTaskId, developmentReceipt(second, 1), { ...developmentPage(second, 0, 1), key })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.ingest(second.runtimeTaskId, developmentReceipt(second), developmentPage(second, 0, 1))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(store.ingest(second.runtimeTaskId, developmentReceipt(second, 6), developmentPage(second, 0, 6))).rejects.toThrow();
    const interrupted = developmentReceipt(second, 1, { interruption: 'journal-limit' }); await store.ingest(second.runtimeTaskId, interrupted);
    await expect(store.ingest(second.runtimeTaskId, developmentReceipt(second, 2))).rejects.toMatchObject({ kind: 'conflict' });
    await store.ingest(second.runtimeTaskId, developmentReceipt(second, 1)); expect((await store.get(second.runtimeTaskId, second.key))?.receipt?.interruption).toBe('journal-limit');
  });

  test('owner release before any receipt persists an open gap; unknown Runner cannot be regressed to running', async () => {
    const { registration: r, store, task, key } = await setup();
    await store.unavailable(task, { key, podUid: r.podUid, reason: 'workspace-released' });
    expect(await store.requestDrain(task, key, 'workspace-released')).toMatchObject({ closure: { status: 'interrupted', persistedThrough: 0, reportedThrough: null, missingAfter: 0, missingThrough: null, tailUnknown: true } });
    const second = developmentRegistration(); await store.register(second);
    await store.ingest(second.runtimeTaskId, developmentReceipt(second, 0, { phase: 'unknown', interruption: 'runner-restarted' }));
    await store.ingest(second.runtimeTaskId, developmentReceipt(second, 0));
    expect((await store.get(second.runtimeTaskId, second.key))?.receipt?.phase).toBe('unknown');
    expect(await store.pending([], 20)).toEqual([]); await expect(store.pending([task], 0)).rejects.toMatchObject({ kind: 'validation' });
    await expect(store.requestDrain(developmentRegistration().runtimeTaskId, key, 'completed')).rejects.toMatchObject({ kind: 'not_found' });
  });
  test('filling a PG gap promotes the whole committed tail before a later Pod loss closes cleanup', async () => {
    const { registration: r, store, source, task, key } = await setup();
    const receipt = developmentReceipt(r, 10, { interruption: 'journal-corrupt' });
    await store.ingest(task, receipt, developmentPage(r, 5, 5)); expect((await store.get(task, key))?.persistedThrough).toBe(0);
    await store.ingest(task, receipt, developmentPage(r, 0, 5)); expect((await store.get(task, key))?.persistedThrough).toBe(10);
    await store.unavailable(task, { key, podUid: r.podUid, reason: 'pod-lost' });
    expect(await store.requestDrain(task, key, 'environment-lost')).toMatchObject({ closure: { status: 'interrupted', persistedThrough: 10, reportedThrough: 10, missingAfter: null, missingThrough: null } });
    const first = (await source.next())!; expect(first).toEqual(developmentPage(r, 0, 5)); await source.acknowledge(key, first.through);
    const tail = (await source.next())!; expect(tail).toEqual(developmentPage(r, 5, 5)); await source.acknowledge(key, tail.through); expect(await source.next()).toBeUndefined();
  });
});
