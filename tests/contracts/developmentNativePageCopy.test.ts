// RFC-034: real native SQLite -> original FULL/WAL journal -> real Session PG and HTTP.
// The transport port is controlled; this does not claim deployed CLI/model or browser acceptance.
import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DevelopmentNativePageEvidenceSchema, DevelopmentNativePreparationSchema, type DevelopmentNativePageChunk, type DevelopmentUsageAdmission, type RunnerCommand } from '../../packages/contracts';
import { PlatformError } from '../../packages/kernel';
import { createTestDatabase, testDatabaseAvailable } from '../../packages/testkit';
import { createApp } from '../../packages/http';
import { createSessionClient } from '../../packages/session-client';
import { openNativeUsagePass, persistNativeUsagePass } from '../../packages/agent-drivers';
import { DevelopmentNativeObserver } from '../../packages/agent-drivers/drivers/usage/developmentNativeObserver';
import { DevelopmentUsageJournal } from '../../runtimes/task/src/agents/developmentUsageJournal';
import { developmentIntentDigest } from '../../runtimes/task/src/agents/developmentStartIntent';
import { readDevelopmentNativePage as runnerPage } from '../../runtimes/task/src/agents/developmentNativePageReader';
import { drizzleDevelopmentUsageStore } from '../../modules/session/adapters/persistence/developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../../modules/session/adapters/persistence/developmentUsageSources';
import { ingestDevelopmentUsage } from '../../modules/session/application/developmentUsageIngestion';
import { readDevelopmentNativePage } from '../../modules/session/application/developmentNativePageRead';
import { developmentUsageRoutes } from '../../modules/session/http/developmentUsageRoutes';
import { createSessionModule, sessionMigrations } from '../../modules/session/wiring';
import { developmentObservationSource } from '../../modules/platform/application/developmentObservationPorts';
import { developmentRegistration } from '../../modules/session/tests/developmentUsageFixtures';

const available = await testDatabaseAvailable(), cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function setup(steps = 1201) {
  const tdb = await createTestDatabase([sessionMigrations]); cleanups.push(() => tdb.drop());
  const directory = await mkdtemp(join(tmpdir(), 'cs-session-native-page-')); cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'native.db'), db = new Database(path); cleanups.push(() => db.close());
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,time_created INTEGER);
    CREATE INDEX session_parent ON session(parent_id,id); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    CREATE INDEX part_session ON part(session_id,id);`);
  db.transaction(() => {
    db.query('INSERT INTO session VALUES(?,?,?)').run('原root🙂', null, null);
    for (let n = 0; n < steps; n++) {
      const id = 'step-' + String(n).padStart(8, '0');
      db.query('INSERT INTO message VALUES(?,?,?)').run(id, '原root🙂', JSON.stringify({ role: 'assistant', providerID: '供应商', modelID: '模型😀'.repeat(60) }));
      db.query('INSERT INTO part VALUES(?,?,?,?,?)').run(id, '原root🙂', id, 1234,
        JSON.stringify({ type: 'step-finish', tokens: { input: n + 1, output: 3, reasoning: 2, cache: { read: 7, write: 13 } } }));
    }
  })();
  const r = developmentRegistration(), journal = new DevelopmentUsageJournal(directory,
    { projectId: r.identity.projectId, workspaceTaskId: r.identity.taskId, runtimeTaskId: r.runtimeTaskId, podUid: r.podUid }, crypto.randomUUID()); cleanups.push(() => journal.close());
  const intent: DevelopmentUsageAdmission['intent'] = { version: 1, identity: r.identity, profileId: r.profileId, profileRevision: r.profileRevision,
    launch: { protocol: 'opencode', binaryPath: '/usr/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full', mode: 'oneshot',
    initialPrompt: null, cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'actual-original-lineage', nativeSource: { version: 2 } };
  const digestNonce = 'a'.repeat(64); r.key = { executionId: r.runtimeTaskId, journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest({ intent, digestNonce }) };
  journal.reserve({ intent, digestNonce, key: r.key }); journal.running(r.key);
  const preparation = DevelopmentNativePreparationSchema.parse({ turn: 'actual-native-turn', turnIndex: 0, rootSessionId: '原root🙂', observedAt: '2026-10-05T00:00:00.000Z', store: new DevelopmentNativeObserver(path).inspect() });
  const identity = { passId: crypto.randomUUID(), turn: preparation.turn, nativeSource: 'opencode:' + preparation.store.actualPathDigest,
    sourceGeneration: hash(preparation.store), rootSessionId: preparation.rootSessionId, lineageKey: intent.nativeUsageLineageKey, epoch: preparation.store.sourceEpoch, phase: 'final' as const };
  const reader = openNativeUsagePass(path, identity, { pageRows: 1000, pageBytes: 512 * 1024 });
  const ack = await persistNativeUsagePass(reader, journal.nativeOwner(r.key, preparation)); reader.close(); journal.finish(r.key, 'completed');
  const store = drizzleDevelopmentUsageStore(tdb.db), source = drizzleDevelopmentUsageSourceStore(tdb.db); await store.register(r);
  const sessionModule = createSessionModule({ db: tdb.db,
    runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'unused raw-copy transport' }) },
    taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
    settings: { selfAddress: 'http://127.0.0.1', commandTimeoutMs: 10000, runnerStaleMs: 30000, replayLimit: 100 },
  });
  const references = new Set<string>();
  const send = async (_taskId: typeof r.runtimeTaskId, command: RunnerCommand) => {
    if (command.type === 'developmentUsageInfo') return journal.info(command.key);
    if (command.type === 'readDevelopmentUsageEvents') return journal.read(command.key, command.after, command.limit);
    if (command.type === 'readDevelopmentNativePage') { references.add(command.ordinal); return runnerPage(journal, command.key, command.passId, command.ordinal, command.afterByte); }
    if (command.type === 'ackDevelopmentUsageEvents') {
      // This checkpoint occurs before real Runner deletion, and queries the real committed PG copy.
      expect((await store.get(r.runtimeTaskId, r.key))!.persistedThrough).toBeGreaterThanOrEqual(command.through);
      for (const ordinal of references) expect((await store.nativePage(r.key, identity.passId, ordinal))?.document).toBe(journal.nativePage(r.key, identity.passId, ordinal).document);
      return journal.acknowledge(command.key, command.through);
    }
    throw new Error('unexpected original page command');
  };
  const app = createApp({ name: 'native-page-copy' }); app.route('/', developmentUsageRoutes({ developmentUsage: store }));
  const client = createSessionClient('http://session', Object.assign(async (url: string | URL | Request, init?: RequestInit) => app.request(new Request(url, init)), { preconnect: fetch.preconnect }));
  return { tdb, journal, r, preparation, identity, ack, store, source, send, client, references, sessionModule };
}
async function drain(f: Awaited<ReturnType<typeof setup>>, send = f.send, store = f.store) {
  for (;;) {
    const before = (await store.get(f.r.runtimeTaskId, f.r.key))!;
    if (before.persistedThrough === Number(f.ack.sourceWatermark) && before.runnerAcknowledgedThrough === before.persistedThrough) return before;
    await ingestDevelopmentUsage({ store, send }, before);
    const next = (await store.get(f.r.runtimeTaskId, f.r.key))!;
    expect(next.persistedThrough > before.persistedThrough || next.runnerAcknowledgedThrough > before.runnerAcknowledgedThrough).toBe(true);
  }
}

describe.skipIf(!available)('all original native page bytes copied before Runner ACK', () => {
  test('every page and Unicode byte reaches durable PG, bounded outbox, strict HTTP and restart through original EOF', async () => {
    const f = await setup(); expect((await drain(f)).complete).toBe(true);
    const platformSource = developmentObservationSource({ resolve: async () => { throw new Error('Raw page read cannot resolve a new numeric owner'); } }, {
      ...f.sessionModule.api,
      getDevelopmentUsage: async () => { throw new Error('Raw page read must use the original independent key'); },
      acknowledgeDevelopmentUsageSource: async () => { throw new Error('Raw page read cannot acknowledge numeric evidence'); },
    });
    let population = 0, ordinal = 0n; const tokens = { input: 0n, output: 0n, cacheRead: 0n, cacheWrite: 0n };
    for (;;) {
      const copy = (await f.source.nativePage!(f.r.key, f.identity.passId, String(ordinal)))!;
      expect(copy.document).toBe(f.journal.nativePage(f.r.key, f.identity.passId, String(ordinal)).document);
      expect(await f.client.readDevelopmentNativePage(f.r.key, f.identity.passId, String(ordinal))).toEqual(copy);
      expect(await platformSource.nativePage(f.r.key, f.identity.passId, String(ordinal))).toEqual(copy);
      const { executionId, journalId, incarnation, payloadDigest } = f.r.key;
      expect(await f.client.readDevelopmentNativePage({ payloadDigest, incarnation, journalId, executionId }, f.identity.passId, String(ordinal))).toEqual(copy);
      expect(copy.rootCreatedAt).toBeNull();
      const raw = JSON.parse(copy.document); population += raw.steps.length;
      for (const step of raw.steps) {
        expect(step.model).toEqual({ provider: '供应商', id: '模型😀'.repeat(60) });
        expect(step.usage).toMatchObject({ output: '5', cacheRead: '7', cacheWrite: '13' });
        for (const bucket of Object.keys(tokens) as Array<keyof typeof tokens>) tokens[bucket] += BigInt(step.usage[bucket]);
      }
      if (raw.eof) { expect(raw.eof.counts.steps).toBe('1201'); break; } ordinal++;
    }
    expect(population).toBe(1201); expect(tokens).toEqual({ input: 721801n, output: 6005n, cacheRead: 8407n, cacheWrite: 15613n }); expect(ordinal).toBeGreaterThan(0n);
    const frozen = await f.store.get(f.r.runtimeTaskId, f.r.key), restarted = drizzleDevelopmentUsageSourceStore(f.tdb.db);
    let packets = 0;
    for (;;) {
      const page = await restarted.next(); if (!page) break;
      expect(await restarted.next()).toEqual(page);
      expect(JSON.stringify(page)).not.toContain('nativeEvidence');
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1024 * 1024);
      packets += page.events.length; await restarted.acknowledge(page.key, page.through);
    }
    expect(packets).toBe(Number(f.ack.sourceWatermark));
    const original = await f.store.nativePage(f.r.key, f.identity.passId, '0');
    expect(await drizzleDevelopmentUsageStore(f.tdb.db).nativePage(f.r.key, f.identity.passId, '0')).toEqual(original);
    expect(original).toBeDefined();
    expect(await platformSource.nativePage(f.r.key, f.identity.passId, '0')).toEqual(original!);
    expect(await platformSource.next()).toBeUndefined();
    expect((await f.store.get(f.r.runtimeTaskId, f.r.key))!.persistedThrough).toBe(frozen!.persistedThrough);
    expect(f.journal.read(f.r.key, Number(f.ack.sourceWatermark)).events).toEqual([]);
    await expect(f.client.readDevelopmentNativePage({ ...f.r.key, journalId: crypto.randomUUID() }, f.identity.passId, '0')).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.client.readDevelopmentNativePage(f.r.key, f.identity.passId, '99999999999999999999999')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(platformSource.nativePage({ ...f.r.key, journalId: crypto.randomUUID() }, f.identity.passId, '0')).rejects.toMatchObject({ kind: 'conflict' });
    await expect(platformSource.nativePage(f.r.key, f.identity.passId, '99999999999999999999999')).rejects.toMatchObject({ kind: 'not_found' });
  }, 20000);

  test('actual PG raw-copy commit failure rolls back numeric rows and never sends a Runner ACK', async () => {
    const f = await setup(101);
    await f.tdb.handle.client`CREATE FUNCTION session.reject_native_copy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event ? 'nativeEvidence' THEN RAISE EXCEPTION 'native copy commit unavailable'; END IF; RETURN NEW; END $$`;
    await f.tdb.handle.client`CREATE TRIGGER reject_native_copy BEFORE UPDATE ON session.development_usage_events FOR EACH ROW EXECUTE FUNCTION session.reject_native_copy()`;
    await expect(ingestDevelopmentUsage({ store: f.store, send: f.send }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!)).rejects.toMatchObject({ cause: { code: 'P0001', message: 'native copy commit unavailable' } });
    expect((await f.store.get(f.r.runtimeTaskId, f.r.key))!.persistedThrough).toBe(0);
    expect((await f.tdb.handle.client`SELECT count(*)::int AS n FROM session.development_usage_events`)[0]?.n).toBe(0);
    expect(f.journal.info(f.r.key).receipt?.acknowledgedSequence).toBe(0);
    await f.tdb.handle.client`DROP TRIGGER reject_native_copy ON session.development_usage_events`;
    expect((await drain(f)).complete).toBe(true);
  }, 15000);

  test('lost actual Runner ACK reply preserves the raw proof and retries after store restart without reading deleted packets', async () => {
    const f = await setup(2); let reads = 0, lose = true;
    const send: typeof f.send = async (taskId, command) => {
      if (command.type === 'readDevelopmentUsageEvents' || command.type === 'readDevelopmentNativePage') reads++;
      const result = await f.send(taskId, command);
      if (command.type === 'ackDevelopmentUsageEvents' && lose) { lose = false; throw new PlatformError('unavailable', 'actual ACK reply lost'); }
      return result;
    };
    await expect(ingestDevelopmentUsage({ store: f.store, send }, (await f.store.get(f.r.runtimeTaskId, f.r.key))!)).rejects.toThrow('actual ACK reply lost');
    const before = await f.store.nativePage(f.r.key, f.identity.passId, '0'), readCount = reads;
    expect(before).toBeDefined(); expect(f.journal.info(f.r.key).receipt?.acknowledgedSequence).toBe(Number(f.ack.sourceWatermark));
    const restarted = drizzleDevelopmentUsageStore(f.tdb.db);
    await ingestDevelopmentUsage({ store: restarted, send }, (await restarted.get(f.r.runtimeTaskId, f.r.key))!);
    expect(reads).toBe(readCount); expect(await restarted.nativePage(f.r.key, f.identity.passId, '0')).toEqual(before);
    expect((await restarted.get(f.r.runtimeTaskId, f.r.key))!.runnerAcknowledgedThrough).toBe(Number(f.ack.sourceWatermark));
  });

  test('missing raw proof cannot become stream completion or Runner ACK; later exact proof is idempotent', async () => {
    const f = await setup(2), receipt = f.journal.info(f.r.key).receipt!, page = f.journal.read(f.r.key, 0);
    const current = await f.store.ingest(f.r.runtimeTaskId, receipt, page);
    expect(current.complete).toBe(false); expect(current.runnerAcknowledgedThrough).toBe(0);
    await expect(f.store.verifyRunnerCopy(f.r.runtimeTaskId, f.r.key, current.persistedThrough)).rejects.toMatchObject({ kind: 'conflict' });
    const evidence = await readDevelopmentNativePage({ send: f.send }, f.r.runtimeTaskId, f.r.key, f.identity.passId, '0');
    const copied = await f.store.ingest(f.r.runtimeTaskId, receipt, page, [evidence]);
    expect(copied.complete).toBe(true); await f.store.verifyRunnerCopy(f.r.runtimeTaskId, f.r.key, copied.persistedThrough);
    expect(await f.store.ingest(f.r.runtimeTaskId, receipt, page, [evidence])).toEqual(copied);
    await expect(f.store.ingest(f.r.runtimeTaskId, receipt, page, [{ ...evidence, podUid: 'other-pod' }])).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.store.verifyRunnerCopy(f.r.runtimeTaskId, f.r.key, copied.persistedThrough + 1)).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('changed chunks, raw hashes, frozen evidence and UTF-8 reject before PG data or ACK writes', async () => {
    const f = await setup();
    const invoke = (change: (packet: DevelopmentNativePageChunk, after: number) => DevelopmentNativePageChunk) => readDevelopmentNativePage({ send: async (_id, command) => {
      if (command.type !== 'readDevelopmentNativePage') throw new Error('only original bytes');
      return change(runnerPage(f.journal, command.key, command.passId, command.ordinal, command.afterByte), command.afterByte);
    } }, f.r.runtimeTaskId, f.r.key, f.identity.passId, '0');
    await expect(invoke((packet, after) => after ? { ...packet, rootCreatedAt: 1 } : packet)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(invoke((packet) => ({ ...packet, document: { ...packet.document, digest: '0'.repeat(64) } }))).rejects.toMatchObject({ kind: 'conflict' });
    await expect(invoke((packet, after) => after ? { ...packet, document: { ...packet.document, afterByte: after - 1, throughByte: packet.document.throughByte - 1 } } : packet)).rejects.toThrow();
    const invalid = Buffer.from([0xc3, 0x28]);
    await expect(invoke((packet) => ({ ...packet, document: { digest: createHash('sha256').update(invalid).digest('hex'), afterByte: 0, throughByte: 2, totalBytes: 2, chunk: invalid.toString('base64'), eof: true } }))).rejects.toThrow();
    const original = DevelopmentNativePageEvidenceSchema.parse({ version: 2, ...f.journal.nativePage(f.r.key, f.identity.passId, '0') });
    const raw = JSON.parse(original.document); raw.steps[0].usage.input = '999999';
    const altered = Buffer.from(JSON.stringify(raw));
    await expect(invoke((packet, after) => {
      const throughByte = Math.min(after + 65536, altered.length);
      return { ...packet, document: { digest: createHash('sha256').update(altered).digest('hex'), afterByte: after, throughByte, totalBytes: altered.length, chunk: altered.subarray(after, throughByte).toString('base64'), eof: throughByte === altered.length } };
    })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.store.get(f.r.runtimeTaskId, f.r.key))!.persistedThrough).toBe(0); expect(f.journal.info(f.r.key).receipt?.acknowledgedSequence).toBe(0);
  }, 15000);
});
