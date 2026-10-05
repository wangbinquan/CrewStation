// RFC-034: actual native SQLite -> committed FULL/WAL journal -> real Runner WebSocket.
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openNativeUsagePass, persistNativeUsagePass } from '@crewstation/agent-drivers';
import { DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES, DevelopmentNativePreparationSchema, DevelopmentUsageAdmissionSchema,
  NativeUsagePassPageSchema, ProjectIdSchema, RunnerResultPayloads, TaskIdSchema,
  type DevelopmentNativePageChunk, type DevelopmentUsageKey, type NativeUsagePassIdentity } from '@crewstation/contracts';
import { DevelopmentNativeObserver } from '../../../packages/agent-drivers/drivers/usage/developmentNativeObserver';
import { DevelopmentUsageJournal } from '../src/agents/developmentUsageJournal';
import { developmentIntentDigest } from '../src/agents/developmentStartIntent';
import { startFakeSession } from './fakeSession';
import { startTestRunner, TEST_TASK_ID } from './testRunner';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (n: number) => `019f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
async function boot(steps = 1201, rootBirth: number | null = 1234) {
  const directory = mkdtempSync(join(tmpdir(), 'cs-native-page-wire-')); cleanups.push(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, 'native.db'), source = new Database(path); cleanups.push(() => source.close());
  source.exec(`PRAGMA journal_mode=WAL; CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,time_created INTEGER);
    CREATE INDEX session_parent ON session(parent_id,id); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    CREATE INDEX part_session ON part(session_id,id);`);
  source.transaction(() => {
    source.query('INSERT INTO session VALUES(?,?,?)').run('root-验证🙂', null, rootBirth);
    for (let n = 0; n < steps; n++) {
      const part = 'step-' + String(n).padStart(8, '0');
      source.query('INSERT INTO message VALUES(?,?,?)').run(part, 'root-验证🙂', JSON.stringify({ role: 'assistant', providerID: '供应商', modelID: '模型😀'.repeat(60) }));
      source.query('INSERT INTO part VALUES(?,?,?,?,?)').run(part, 'root-验证🙂', part, 2346,
        JSON.stringify({ type: 'step-finish', tokens: { input: n + 1, output: 3, reasoning: 2, cache: { read: 7, write: 13 } } }));
    }
  })();
  const context = { runtimeTaskId: TEST_TASK_ID, projectId: ProjectIdSchema.parse(id(1)), workspaceTaskId: TaskIdSchema.parse(id(2)), podUid: 'original-page-pod' };
  const journal = new DevelopmentUsageJournal(directory, context, randomUUID()); cleanups.push(() => journal.close());
  const intent = { version: 1 as const, identity: { sourceKind: 'development-agent' as const, projectId: context.projectId,
    taskId: context.workspaceTaskId, executionId: context.runtimeTaskId, executionGeneration: 1 as const, agentId: id(4) },
    profileId: id(5), profileRevision: 1, launch: { protocol: 'opencode' as const, binaryPath: '/usr/bin/opencode', extraArgs: [], isSandbox: false },
    permission: 'full' as const, mode: 'interactive' as const, initialPrompt: null, cwd: null, resumeSessionId: null,
    systemPrompt: null, mcp: [], nativeUsageLineageKey: 'original-wire-lineage', nativeSource: { version: 2 as const } };
  const base = { intent, digestNonce: 'a'.repeat(64) };
  const admission = DevelopmentUsageAdmissionSchema.parse({ ...base, key: { executionId: TEST_TASK_ID, journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest(base) } });
  journal.reserve(admission); journal.running(admission.key);
  const prepared = DevelopmentNativePreparationSchema.parse({ turn: 'wire-turn', turnIndex: 0, rootSessionId: 'root-验证🙂', observedAt: '2026-10-05T00:00:00.000Z', store: new DevelopmentNativeObserver(path).inspect() });
  const identity: NativeUsagePassIdentity = { passId: randomUUID(), turn: prepared.turn, nativeSource: 'opencode:' + prepared.store.actualPathDigest,
    sourceGeneration: hash(prepared.store), rootSessionId: prepared.rootSessionId, lineageKey: intent.nativeUsageLineageKey, epoch: prepared.store.sourceEpoch, phase: 'final' };
  const reader = openNativeUsagePass(path, identity, { pageRows: 1000, pageBytes: 512 * 1024 });
  const ack = await persistNativeUsagePass(reader, journal.nativeOwner(admission.key, prepared)); reader.close();
  const session = startFakeSession(); cleanups.push(() => session.stop());
  const runner = await startTestRunner(session.url, {}, { developmentUsageJournal: journal }); cleanups.push(() => runner.dispose()); await runner.runner.whenConnected();
  return { directory, context, journal, admission, identity, ack, session, runner };
}
async function copyPage(f: Awaited<ReturnType<typeof boot>>, ordinal: string, key: DevelopmentUsageKey = f.admission.key) {
  const chunks: Buffer[] = []; let afterByte = 0, first: DevelopmentNativePageChunk | undefined;
  for (;;) {
    const packet = RunnerResultPayloads.developmentNativePage.parse(await f.session.call({ id: randomUUID(), type: 'readDevelopmentNativePage', key, passId: f.identity.passId, ordinal, afterByte }));
    expect(packet.key).toEqual(key); expect(packet.document.afterByte).toBe(afterByte);
    const { document: _document, ...metadata } = packet;
    if (first) { const { document: _firstDocument, ...original } = first; expect(metadata).toEqual(original); expect(packet.document.digest).toBe(first.document.digest); expect(packet.document.totalBytes).toBe(first.document.totalBytes); }
    first ??= packet; const bytes = Buffer.from(packet.document.chunk, 'base64'); chunks.push(bytes);
    expect(bytes.length).toBeLessThanOrEqual(DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES); afterByte = packet.document.throughByte;
    if (packet.document.eof) break;
    expect(bytes.length).toBeGreaterThan(0);
  }
  const raw = Buffer.concat(chunks);
  expect(raw.length).toBe(first!.document.totalBytes); expect(createHash('sha256').update(raw).digest('hex')).toBe(first!.document.digest);
  return { document: raw.toString('utf8'), page: NativeUsagePassPageSchema.parse(JSON.parse(raw.toString('utf8'))), chunks: chunks.length, original: first! };
}
test('all actual pages and Unicode bytes cross the Runner channel to original EOF without numeric watermark changes', async () => {
  const f = await boot(), before = f.journal.info(f.admission.key); let steps = 0, chunks = 0, ordinal = 0n;
  for (;;) {
    const copied = await copyPage(f, String(ordinal));
    expect(copied.document).toBe(f.journal.nativePage(f.admission.key, f.identity.passId, String(ordinal)).document);
    steps += copied.page.steps.length; chunks += copied.chunks; expect(copied.original.rootCreatedAt).toBe(1234);
    if (copied.page.eof) { expect(copied.page.eof.counts.steps).toBe('1201'); break; } ordinal++;
  }
  expect(steps).toBe(1201); expect(chunks).toBeGreaterThan(Number(ordinal) + 1); expect(f.journal.info(f.admission.key)).toEqual(before);
});
test('ordinary ACK and finish retain raw page transport and unknown original root birth', async () => {
  const f = await boot(101, null), original = await copyPage(f, '0');
  f.journal.acknowledge(f.admission.key, Number(f.ack.sourceWatermark)); f.journal.finish(f.admission.key, 'completed');
  expect(await copyPage(f, '0')).toEqual(original); expect(original.original.rootCreatedAt).toBeNull();
  expect(f.journal.read(f.admission.key, Number(f.ack.sourceWatermark)).events).toEqual([]);
  const beyond = Buffer.byteLength(original.document) + 1;
  await expect(f.session.call({ id: randomUUID(), type: 'readDevelopmentNativePage', key: f.admission.key, passId: f.identity.passId, ordinal: '0', afterByte: beyond })).rejects.toMatchObject({ code: 'development_native_page_range' });
  await expect(f.session.call({ id: randomUUID(), type: 'readDevelopmentNativePage', key: { ...f.admission.key, payloadDigest: '0'.repeat(64) }, passId: f.identity.passId, ordinal: '0', afterByte: 0 })).rejects.toThrow();
});
test('historical original page remains readable through a real restarted Runner without granting current write authority', async () => {
  const f = await boot(2), original = await copyPage(f, '0'); await f.runner.dispose();
  const recovered = new DevelopmentUsageJournal(f.directory, f.context, randomUUID()); cleanups.push(() => recovered.close());
  const nextSession = startFakeSession(); cleanups.push(() => nextSession.stop());
  const nextRunner = await startTestRunner(nextSession.url, {}, { developmentUsageJournal: recovered }); cleanups.push(() => nextRunner.dispose()); await nextRunner.runner.whenConnected();
  expect(await copyPage({ ...f, journal: recovered, session: nextSession, runner: nextRunner }, '0')).toEqual(original);
  expect(recovered.info(f.admission.key).receipt?.interruption).toBe('runner-restarted');
  expect(() => recovered.nativeOwner(f.admission.key, original.original.preparation)).toThrow();
});
