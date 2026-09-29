// RFC-034 module regression: real PG, fake numeric Runner port; cross-unit real journal cases live in tests/e2e/developmentUsageJournalCopy.test.ts.
import { afterEach, describe, expect, test } from 'bun:test';
import { PlatformError } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleDevelopmentUsageStore } from '../adapters/persistence/developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../adapters/persistence/developmentUsageSources';
import { ingestDevelopmentUsage } from '../application/developmentUsageIngestion';
import { sessionMigrations } from '../wiring';
import { developmentAt, developmentCapture, developmentPage, developmentReceipt, developmentRegistration } from './developmentUsageFixtures';

import type { RunnerCommand } from '@crewstation/contracts';
import { fakeDevelopmentUsagePeer } from './fakeDevelopmentUsagePeer';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('Runner development journal to durable PG ingestion', () => {
  let tdb: TestDatabase, journal: ReturnType<typeof fakeDevelopmentUsagePeer>;
  afterEach(async () => { await tdb?.drop(); });
  const setup = async () => {
    tdb = await createTestDatabase([sessionMigrations]); const r = developmentRegistration(); journal = fakeDevelopmentUsagePeer(r);
    const store = drizzleDevelopmentUsageStore(tdb.db); await store.register(r);
    const send = async (_taskId: typeof r.runtimeTaskId, command: RunnerCommand) => {
      if (command.type === 'developmentUsageInfo') return journal.info(command.key);
      if (command.type === 'readDevelopmentUsageEvents') return journal.read(command.key, command.after, command.limit);
      if (command.type === 'ackDevelopmentUsageEvents') return journal.acknowledge(command.key, command.through);
      throw new Error('unexpected numeric command');
    };
    return { r, store, source: drizzleDevelopmentUsageSourceStore(tdb.db), send, admit: () => journal.reserve() };
  };

  test('receipt loss after Runner deletion resumes from PG M and never rereads or ACKs an uncommitted page', async () => {
    const f = await setup(); f.admit(); journal.running(f.r.key); journal.capture(f.r.key, developmentCapture(1), developmentAt); journal.finish(f.r.key, 'completed');
    let loseAck = true, reads = 0;
    const send: typeof f.send = async (taskId, command) => {
      if (command.type === 'readDevelopmentUsageEvents') reads++;
      if (command.type === 'ackDevelopmentUsageEvents') {
        expect((await f.store.get(taskId, f.r.key))?.persistedThrough).toBe(1);
        const value = await f.send(taskId, command);
        if (loseAck) { loseAck = false; throw new PlatformError('unavailable', 'ACK reply lost'); } return value;
      }
      return f.send(taskId, command);
    };
    await expect(ingestDevelopmentUsage({ store: f.store, send }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!)).rejects.toThrow('ACK reply lost');
    expect(await f.store.get(f.r.runtimeTaskId, f.r.key)).toMatchObject({ complete: true, persistedThrough: 1, runnerAcknowledgedThrough: 0 });
    const restarted = drizzleDevelopmentUsageStore(tdb.db);
    await ingestDevelopmentUsage({ store: restarted, send }, (await restarted.get(f.r.runtimeTaskId, f.r.key))!);
    expect(reads).toBe(1); expect((await restarted.get(f.r.runtimeTaskId, f.r.key))?.runnerAcknowledgedThrough).toBe(1);
    expect(journal.read(f.r.key, 1).events).toEqual([]); expect(await f.source.next()).toEqual(developmentPage(f.r, 0, 1));
    expect(JSON.stringify(await restarted.get(f.r.runtimeTaskId, f.r.key))).not.toContain('owner-private');
  });

  test('interrupted N=10 with copied M=8 drains real readable records 9/10 before owner cleanup', async () => {
    const f = await setup(); f.admit(); journal.running(f.r.key);
    for (let i = 1; i <= 10; i++) journal.capture(f.r.key, developmentCapture(i), developmentAt);
    const initial = journal.info(f.r.key).receipt!;
    await f.store.ingest(f.r.runtimeTaskId, initial, journal.read(f.r.key, 0, 5)); await f.store.ingest(f.r.runtimeTaskId, initial, journal.read(f.r.key, 5, 3));
    journal.interrupt(f.r.runtimeTaskId, 'journal-limit'); journal.finish(f.r.key, 'completed');
    expect(await f.store.requestDrain(f.r.runtimeTaskId, f.r.key, 'completed')).toMatchObject({ persistedThrough: 8, closure: null });
    await ingestDevelopmentUsage({ store: f.store, send: f.send }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!);
    expect(await f.store.get(f.r.runtimeTaskId, f.r.key)).toMatchObject({ persistedThrough: 10, runnerAcknowledgedThrough: 10, complete: false, closure: { status: 'interrupted', missingAfter: null, tailUnknown: true } });
    expect(journal.info(f.r.key).receipt?.acknowledgedSequence).toBe(10);
  });

  test('PG transaction failure and transient network timeout cannot become a loss proof or advance Runner ACK', async () => {
    const f = await setup(); f.admit(); journal.capture(f.r.key, developmentCapture(1), developmentAt);
    const real = f.store.ingest.bind(f.store); let fail = true;
    f.store.ingest = async (taskId, receipt, page) => { if (page && fail) { fail = false; throw new Error('PG transaction unavailable'); } return real(taskId, receipt, page); };
    await expect(ingestDevelopmentUsage({ store: f.store, send: f.send }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!)).rejects.toThrow('PG transaction unavailable');
    expect(journal.info(f.r.key).receipt?.acknowledgedSequence).toBe(0);
    expect(await f.store.get(f.r.runtimeTaskId, f.r.key)).toMatchObject({ persistedThrough: 0, loss: null, closure: null });
    await expect(ingestDevelopmentUsage({ store: f.store, send: async () => { throw new PlatformError('unavailable', 'network timeout', { code: 'timeout' }); } }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!)).rejects.toThrow('network timeout');
    expect((await f.store.get(f.r.runtimeTaskId, f.r.key))?.loss).toBeNull();
    await ingestDevelopmentUsage({ store: f.store, send: f.send }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!);
    expect((await f.store.get(f.r.runtimeTaskId, f.r.key))?.persistedThrough).toBe(1);
  });

  test('a replacement empty journal or Pod never becomes a new acceptance of the original execution', async () => {
    const f = await setup(); f.admit(); journal.capture(f.r.key, developmentCapture(1), developmentAt);
    await f.store.ingest(f.r.runtimeTaskId, journal.info(f.r.key).receipt!, journal.read(f.r.key, 0));
    const replaced = { version: 1 as const, runtimeTaskId: f.r.runtimeTaskId, podUid: f.r.podUid, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), receipt: null };
    await ingestDevelopmentUsage({ store: f.store, send: async () => replaced }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!);
    expect(await f.store.get(f.r.runtimeTaskId, f.r.key)).toMatchObject({ registration: { key: f.r.key }, persistedThrough: 1, loss: { reason: 'journal-replaced' }, closure: null });
    expect(await f.store.requestDrain(f.r.runtimeTaskId, f.r.key, 'environment-lost')).toMatchObject({ closure: { status: 'interrupted', persistedThrough: 1 } });
    const second = developmentRegistration(); await f.store.register(second);
    const info = { ...replaced, runtimeTaskId: second.runtimeTaskId, journalId: second.key.journalId, incarnation: second.key.incarnation, podUid: 'another-pod' };
    await ingestDevelopmentUsage({ store: f.store, send: async () => info }, (await f.store.get(second.runtimeTaskId, second.key))!);
    expect((await f.store.get(second.runtimeTaskId, second.key))?.loss?.reason).toBe('journal-replaced');
  });

  test('old-incarnation receipts retain original identity, but lost admissions and explicit unreadable replies remain incomplete', async () => {
    const f = await setup(); f.admit(); journal.capture(f.r.key, developmentCapture(1), developmentAt);
    const info = journal.info(f.r.key);
    await ingestDevelopmentUsage({ store: f.store, send: async (_taskId, command) => command.type === 'developmentUsageInfo' ? { ...info, incarnation: crypto.randomUUID() } : f.send(_taskId, command) }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!);
    expect((await f.store.get(f.r.runtimeTaskId, f.r.key))?.persistedThrough).toBe(1);
    await ingestDevelopmentUsage({ store: f.store, send: async () => ({ ...info, receipt: null }) }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!);
    expect(await f.store.get(f.r.runtimeTaskId, f.r.key)).toMatchObject({ persistedThrough: 1, loss: null, closure: null });
    const second = developmentRegistration(); await f.store.register(second); await f.store.ingest(second.runtimeTaskId, developmentReceipt(second, 10, { interruption: 'journal-corrupt' }), developmentPage(second, 0, 5));
    await f.store.requestDrain(second.runtimeTaskId, second.key, 'cancelled');
    await ingestDevelopmentUsage({ store: f.store, send: async () => { throw new PlatformError('precondition', 'bound journal lost', { code: 'development_journal_lost' }); } }, (await f.store.get(second.runtimeTaskId, second.key))!);
    expect(await f.store.get(second.runtimeTaskId, second.key)).toMatchObject({ persistedThrough: 5, runnerAcknowledgedThrough: 0, closure: { status: 'interrupted', missingAfter: 5, missingThrough: 10 } });
  });

  test('healthy unaccepted info is neither a measured zero nor a fake completion; different task or receipt bindings reject', async () => {
    const f = await setup();
    await ingestDevelopmentUsage({ store: f.store, send: f.send }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!);
    expect(await f.store.get(f.r.runtimeTaskId, f.r.key)).toMatchObject({ receipt: null, complete: false, closure: null });
    const foreign = developmentRegistration();
    await expect(ingestDevelopmentUsage({ store: f.store, send: async () => ({ ...journal.info(), runtimeTaskId: foreign.runtimeTaskId }) }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!)).rejects.toMatchObject({ kind: 'conflict' });
    f.admit();
    await expect(ingestDevelopmentUsage({ store: f.store, send: async () => ({ ...journal.info(), receipt: { ...journal.info().receipt!, profileRevision: 4 } }) }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!)).rejects.toMatchObject({ kind: 'conflict' });
  });
});
