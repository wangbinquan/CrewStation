// RFC-034: actual native SQLite, original FULL/WAL journal COMMIT and numeric replay.
// A page/SDK callback/exit cannot stand in for a durable original-owner ACK.
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openNativeUsagePass, persistNativeUsagePass } from '@crewstation/agent-drivers';
import { DevelopmentNativePreparationSchema, DevelopmentUsageAdmissionSchema, ProjectIdSchema, TaskIdSchema,
  type DevelopmentUsageAdmission, type DevelopmentUsageEvent, type NativeUsagePassIdentity } from '@crewstation/contracts';
import { DevelopmentNativeObserver } from '../../../../packages/agent-drivers/drivers/usage/developmentNativeObserver';
import { DevelopmentUsageJournal } from './developmentUsageJournal';
import { developmentIntentDigest } from './developmentStartIntent';

const at = '2026-10-05T00:00:00.000Z';
const resource = (n: number) => `019f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const context = { runtimeTaskId: TaskIdSchema.parse(resource(3)), workspaceTaskId: TaskIdSchema.parse(resource(2)),
  projectId: ProjectIdSchema.parse(resource(1)), podUid: 'actual-original-pod' };
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(steps = 2, depth = 0, selected = true, rootBirth: number | null = 1234) {
  const directory = mkdtempSync(join(tmpdir(), 'cs-native-owner-'));
  cleanup.push(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, 'native.db'), original = new Database(path);
  cleanup.push(() => original.close());
  original.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,time_created INTEGER);
    CREATE INDEX session_parent ON session(parent_id,id);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    CREATE INDEX part_session ON part(session_id,id);`);
  const step = (id: string, session: string, input: number) => {
    original.query('INSERT INTO message VALUES(?,?,?)').run(id, session,
      JSON.stringify({ role: 'assistant', providerID: 'provider', modelID: 'model' }));
    original.query('INSERT INTO part VALUES(?,?,?,?,?)').run(id + '-a', session, id, 2345, JSON.stringify({ type: 'step-start' }));
    original.query('INSERT INTO part VALUES(?,?,?,?,?)').run(id + '-z', session, id, 2346,
      JSON.stringify({ type: 'step-finish', tokens: { input, output: 3, reasoning: 2, cache: { read: 7, write: 13 } } }));
  };
  original.transaction(() => {
    original.query('INSERT INTO session VALUES(?,?,?)').run('root', null, rootBirth);
    for (let n = 0; n < steps; n++) step('step-' + String(n).padStart(6, '0'), 'root', n + 1);
    for (let n = 1; n <= depth; n++) original.query('INSERT INTO session VALUES(?,?,?)').run('child-' + n, n === 1 ? 'root' : 'child-' + (n - 1), 1235);
    if (depth) step('deep-step', 'child-' + depth, 10001);
    original.query('INSERT INTO session VALUES(?,?,?)').run('unrelated', null, 1000); step('not-this-root', 'unrelated', 999999);
  })();
  const journal = new DevelopmentUsageJournal(directory, context, randomUUID()); cleanup.push(() => journal.close());
  const intent = { version: 1 as const, identity: { sourceKind: 'development-agent' as const, projectId: context.projectId,
    taskId: context.workspaceTaskId, executionId: context.runtimeTaskId, executionGeneration: 1 as const, agentId: resource(4) },
    profileId: resource(5), profileRevision: 2, launch: { protocol: 'opencode' as const, binaryPath: '/usr/bin/opencode', extraArgs: [], isSandbox: false },
    permission: 'full' as const, mode: 'interactive' as const, initialPrompt: null, cwd: null, resumeSessionId: null,
    systemPrompt: null, mcp: [], nativeUsageLineageKey: 'accepted-original-lineage', ...(selected ? { nativeSource: { version: 2 as const } } : {}) };
  const base = { intent, digestNonce: 'a'.repeat(64) };
  const admission = DevelopmentUsageAdmissionSchema.parse({ ...base, key: { executionId: context.runtimeTaskId,
    journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest(base) } });
  journal.reserve(admission); journal.running(admission.key);
  const observer = new DevelopmentNativeObserver(path);
  const prepared = DevelopmentNativePreparationSchema.parse({ turn: 'accepted-turn', turnIndex: 0, rootSessionId: 'root',
    observedAt: at, store: observer.inspect() });
  const identity: NativeUsagePassIdentity = { passId: randomUUID(), turn: prepared.turn,
    nativeSource: 'opencode:' + prepared.store.actualPathDigest, sourceGeneration: digest(prepared.store),
    rootSessionId: prepared.rootSessionId, lineageKey: admission.intent.nativeUsageLineageKey,
    epoch: prepared.store.sourceEpoch, phase: 'final' };
  const reader = openNativeUsagePass(path, identity, { pageRows: 1000, pageBytes: 512 * 1024 }); cleanup.push(() => reader.close());
  const storage = new Database(join(directory, 'executions.sqlite')); cleanup.push(() => storage.close());
  const owner = () => journal.nativeOwner(admission.key, prepared);
  return { directory, original, journal, admission, prepared, identity, reader, storage, owner };
}
function drain(journal: DevelopmentUsageJournal, admission: DevelopmentUsageAdmission): DevelopmentUsageEvent[] {
  const events: DevelopmentUsageEvent[] = [], last = journal.info(admission.key).receipt!.lastSequence;
  let after = 0;
  while (after < last) {
    const page = journal.read(admission.key, after);
    expect(page.events.length).toBeGreaterThan(0); expect(page.through).toBeGreaterThan(after);
    events.push(...page.events); after = page.through;
  }
  expect(after).toBe(last); return events;
}

test('real original owner commits all 12002 steps, four buckets and an 80-level path through native EOF', async () => {
  const f = fixture(12001, 80), ack = await persistNativeUsagePass(f.reader, f.owner());
  expect(ack.eof).not.toBeNull(); expect(ack.counts).toEqual({ sessions: '81', parts: '24004', steps: '12002' });
  expect(f.storage.query<{ root_created_at: number }, []>('SELECT root_created_at FROM development_native_passes').get()?.root_created_at).toBe(1234);
  const events = drain(f.journal, f.admission), ids = new Set<string>(), total = { input: 0n, output: 0n, cacheRead: 0n, cacheWrite: 0n };
  for (const event of events) {
    expect(event.capture.version).toBe(2); if (event.capture.version !== 2) throw new Error('Native frame was downgraded');
    const source = event.capture.nativeSource;
    expect(event.sequence).toBe(source.sequence); expect(source.ack.sourceWatermark).toBe(String(source.sequenceThrough));
    for (const measurement of event.capture.measurements) {
      expect(ids.has(measurement.stepId)).toBe(false); ids.add(measurement.stepId);
      expect(measurement.model).toEqual({ provider: 'provider', id: 'model' }); expect(measurement.occurredAt).toBe(2346);
      for (const bucket of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) total[bucket] += BigInt(measurement.usage[bucket]!);
    }
  }
  expect(ids.size).toBe(12002); expect(ids.has('not-this-root-z')).toBe(false);
  expect(total).toEqual({ input: 12001n * 12002n / 2n + 10001n, output: 12002n * 5n, cacheRead: 12002n * 7n, cacheWrite: 12002n * 13n });
  expect(f.journal.info(f.admission.key).receipt).toMatchObject({ phase: 'running', interruption: null, lastSequence: Number(ack.sourceWatermark), finalThrough: null });
  expect(f.storage.query<{ depth: string }, []>("SELECT depth FROM development_native_parents WHERE session_id='child-80'").get()?.depth).toBe('80');
});
test('lost durable ACK replays its original bytes once, including after ordinary numeric ACK pruning', async () => {
  const f = fixture(251), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt);
  const ack = await owner.persist(page), first = drain(f.journal, f.admission);
  expect(first.length).toBeGreaterThan(1); expect(await owner.persist(page)).toEqual(ack);
  expect(drain(f.journal, f.admission)).toEqual(first);
  f.journal.acknowledge(f.admission.key, Number(ack.sourceWatermark));
  expect(await owner.persist(page)).toEqual(ack);
  expect(f.storage.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM events').get()?.count).toBe(0);
  expect(f.storage.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM development_native_steps').get()?.count).toBe(page.steps.length);
});
test('actual append failure rolls back membership, parent, page, source and cursor before any positive ACK', async () => {
  const f = fixture(), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt);
  f.storage.exec("CREATE TRIGGER fail_native BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL, 'actual native append failed'); END;");
  await expect(owner.persist(page)).rejects.toThrow('actual native append failed');
  for (const table of ['development_native_pages', 'development_native_steps', 'development_native_parents', 'events'])
    expect(f.storage.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM ' + table).get()?.count).toBe(0);
  expect(f.journal.info(f.admission.key).receipt?.lastSequence).toBe(0);
  expect(f.reader.next(f.reader.initialCursor)).toEqual(page);
  f.storage.exec('DROP TRIGGER fail_native'); const ack = await owner.persist(page);
  expect(Number(ack.sourceWatermark)).toBeGreaterThan(0); f.reader.acknowledge(page.ordinal, page.payloadDigest);
});
test.each(['membership', 'parent', 'pending-frame'] as const)('replay refuses missing retained original %s instead of returning ACK', async (kind) => {
  const f = fixture(), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt); await owner.persist(page);
  f.storage.exec('DELETE FROM ' + ({ membership: 'development_native_steps', parent: 'development_native_parents', 'pending-frame': 'events' }[kind]));
  await expect(owner.persist(page)).rejects.toThrow(/missing|changed/);
});
test('replay checks every retained ancestor and root, beyond the current page and 64 levels', async () => {
  const f = fixture(1, 80), owner = f.owner(); await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt);
  const page = f.reader.next(f.reader.initialCursor); await owner.persist(page);
  f.storage.exec("DELETE FROM development_native_parents WHERE session_id='child-20'");
  await expect(owner.persist(page)).rejects.toThrow('full parent path is missing');
});
test('original admission rejects legacy selection, changed root/source, replacement incarnation and completed phase', async () => {
  const legacy = fixture(1, 0, false); expect(() => legacy.owner()).toThrow('did not explicitly select native v2');
  const f = fixture(), owner = f.owner();
  await expect(owner.admit({ ...f.identity, sourceGeneration: 'different-source' }, f.reader.initialCursor, f.reader.rootCreatedAt)).rejects.toThrow();
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt);
  await expect(owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt! + 1)).rejects.toThrow('original bytes');
  expect(() => f.journal.nativeOwner({ ...f.admission.key, incarnation: randomUUID() }, f.prepared)).toThrow();
  f.journal.finish(f.admission.key, 'completed'); await expect(owner.persist(f.reader.next(f.reader.initialCursor))).rejects.toThrow('current original');
});
test('altered original payload or population cannot advance the source, and unknown root birth stays null', async () => {
  const f = fixture(2, 0, true, null), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt);
  await expect(owner.persist({ ...page, counts: { ...page.counts, steps: '999' } })).rejects.toThrow('Native EOF must retain the exact cumulative population');
  await expect(owner.persist({ ...page, steps: page.steps.map((step, index) => index === 0 ? { ...step, usage: { ...step.usage, input: '999' } } : step) })).rejects.toThrow('digests');
  expect(f.journal.info(f.admission.key).receipt?.lastSequence).toBe(0);
  expect(f.reader.rootCreatedAt).toBeNull(); const ack = await owner.persist(page); expect(ack.counts.steps).toBe('2');
  expect(f.storage.query<{ root_created_at: number | null }, []>('SELECT root_created_at FROM development_native_passes').get()?.root_created_at).toBeNull();
});
test('real restart keeps committed source frames and refuses an old native pass or synthetic terminal', async () => {
  const f = fixture(), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt); await owner.persist(page);
  const original = drain(f.journal, f.admission), restarted = new DevelopmentUsageJournal(f.directory, context, randomUUID()); cleanup.push(() => restarted.close());
  expect(restarted.info(f.admission.key).receipt).toMatchObject({ phase: 'unknown', interruption: 'runner-restarted' });
  expect(drain(restarted, f.admission)).toEqual(original);
  expect(() => restarted.nativeOwner(f.admission.key, f.prepared)).toThrow('current original');
  expect(() => restarted.finish(f.admission.key, 'completed')).toThrow('不能伪造完成');
});
test('the original numeric outbox persists beyond 64MiB without a cumulative population cutoff', async () => {
  const f = fixture(0), frame = { version: 1 as const, diagnostics: [], measurements: Array.from({ length: 100 }, (_, n) => ({
    recordId: 'original-sdk-' + n + '-'.repeat(340), revision: 1, occurredAt: at, observedAt: at,
    adapterVersion: 'original-sdk', reporting: 'delta' as const, inclusion: 'self' as const,
    coverage: 'complete' as const, validity: 'valid' as const, scope: null, coveredThroughTurn: null,
    usage: { input: '11', output: '5', cacheRead: '7', cacheWrite: '13' }, basis: { kind: 'invocation' as const }, actualModel: null,
  })) };
  const eventSize = Buffer.byteLength(JSON.stringify({ sequence: 1, occurredAt: at, capture: frame }));
  const count = Math.ceil((64 * 1024 * 1024 + 1024) / eventSize) + 1;
  for (let n = 0; n < count; n++) f.journal.capture(f.admission.key, frame, at);
  const stored = f.storage.query<{ count: number; bytes: number }, []>('SELECT COUNT(*) AS count,SUM(bytes) AS bytes FROM events').get()!;
  expect(stored.bytes).toBeGreaterThan(64 * 1024 * 1024); expect(stored.count).toBe(count);
  expect(f.journal.info(f.admission.key).receipt).toMatchObject({ lastSequence: count, interruption: null });
  const events = drain(f.journal, f.admission);
  expect(events.length).toBe(count); expect(events[0]?.capture).toEqual(frame); expect(events.at(-1)?.sequence).toBe(count);
  f.journal.finish(f.admission.key, 'completed'); expect(f.journal.info(f.admission.key).receipt?.finalThrough).toBe(count);
}, 120000);


test('retained native page reads exact original bytes and ACK after normal pruning and finish', async () => {
  const f = fixture(251), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt);
  const ack = await owner.persist(page), before = f.journal.info(f.admission.key);
  const evidence = f.journal.nativePage(f.admission.key, f.identity.passId, page.ordinal);
  expect(evidence.document).toBe(JSON.stringify(page)); expect(evidence.ack).toEqual(ack);
  expect(evidence).toMatchObject({ key: f.admission.key, podUid: context.podUid,
    preparation: f.prepared, baselineKind: 'fresh', rootCreatedAt: 1234 });
  expect(evidence.admission).toMatchObject({ identity: f.identity, initialCursor: f.reader.initialCursor, ownerReceiptId: ack.ownerReceiptId });
  expect(f.journal.info(f.admission.key)).toEqual(before);
  f.journal.acknowledge(f.admission.key, Number(ack.sourceWatermark)); f.journal.finish(f.admission.key, 'completed');
  const finished = f.journal.info(f.admission.key);
  expect(f.journal.nativePage(f.admission.key, f.identity.passId, page.ordinal)).toEqual(evidence);
  expect(f.journal.info(f.admission.key)).toEqual(finished);
});
test('native read remains historical after a real restart, without manufacturing current ownership', async () => {
  const f = fixture(), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt); await owner.persist(page);
  const evidence = f.journal.nativePage(f.admission.key, f.identity.passId, page.ordinal);
  const restarted = new DevelopmentUsageJournal(f.directory, context, randomUUID()); cleanup.push(() => restarted.close());
  expect(restarted.nativePage(f.admission.key, f.identity.passId, page.ordinal)).toEqual(evidence);
  expect(restarted.info(f.admission.key).receipt).toMatchObject({ phase: 'unknown', interruption: 'runner-restarted', finalThrough: null });
  expect(() => restarted.nativeOwner(f.admission.key, f.prepared)).toThrow('current original');
});
test.each(['membership', 'parent', 'pending-frame', 'preparation', 'page'] as const)('native reads refuse missing original %s', async (kind) => {
  const f = fixture(), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt); await owner.persist(page);
  f.storage.exec('DELETE FROM ' + ({ membership: 'development_native_steps', parent: 'development_native_parents',
    'pending-frame': 'events', preparation: 'development_native_preparations', page: 'development_native_pages' }[kind]));
  expect(() => f.journal.nativePage(f.admission.key, f.identity.passId, page.ordinal)).toThrow(/missing|changed|unavailable/);
});
test('native reads refuse changed raw bytes, original key or another pass rather than returning current data', async () => {
  const f = fixture(), owner = f.owner(), page = f.reader.next(f.reader.initialCursor);
  await owner.admit(f.identity, f.reader.initialCursor, f.reader.rootCreatedAt); await owner.persist(page);
  for (const [key, pass, ordinal] of [[{ ...f.admission.key, payloadDigest: 'b'.repeat(64) }, f.identity.passId, page.ordinal],
    [f.admission.key, 'other-pass', page.ordinal], [f.admission.key, f.identity.passId, '01']] as const)
    expect(() => f.journal.nativePage(key, pass, ordinal)).toThrow();
  const altered = { ...page, steps: page.steps.map((step) => ({ ...step, usage: { ...step.usage, input: '999' } })) };
  f.storage.query('UPDATE development_native_pages SET document=? WHERE pass_id=? AND ordinal=?').run(JSON.stringify(altered), f.identity.passId, page.ordinal);
  expect(() => f.journal.nativePage(f.admission.key, f.identity.passId, page.ordinal)).toThrow('digest changed');
});

test('all retained pages remain readable through actual EOF and unknown root birth stays unknown', async () => {
  const f = fixture(2501, 0, true, null), final = await persistNativeUsagePass(f.reader, f.owner());
  f.journal.acknowledge(f.admission.key, Number(final.sourceWatermark));
  let ordinal = 0n, steps = 0n, input = 0n;
  for (;;) {
    const original = f.journal.nativePage(f.admission.key, f.identity.passId, String(ordinal));
    expect(original.rootCreatedAt).toBeNull(); expect(original.ack.ordinal).toBe(String(ordinal));
    const page = JSON.parse(original.document);
    for (const step of page.steps) { steps++; input += BigInt(step.usage.input); }
    if (original.ack.eof !== null) { expect(original.ack).toEqual(final); break; }
    ordinal++;
  }
  expect(ordinal).toBeGreaterThan(0n); expect(steps).toBe(2501n); expect(input).toBe(2501n * 2502n / 2n);
  expect(f.storage.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM events').get()?.count).toBe(0);
  f.storage.exec('UPDATE development_native_passes SET root_created_at=-1');
  expect(() => f.journal.nativePage(f.admission.key, f.identity.passId, '0')).toThrow('root birth is invalid');
});
