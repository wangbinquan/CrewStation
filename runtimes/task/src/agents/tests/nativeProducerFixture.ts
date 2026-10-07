// Controlled driver/WAL/journal acceptance; no supplier call or provider bill.
import { afterEach, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DevelopmentUsageAdmissionSchema, TaskIdSchema, ProjectIdSchema, type AgentEvent, type DevelopmentUsageAdmission, type DevelopmentUsageRegistration } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { type DevelopmentNativeTurnInput, recordOpencodeBinaryVersion, resetOpencodeBinaryVersions, resetOpencodeProbes } from '@crewstation/agent-drivers';
import { createProcessLauncher, type PipedProcess } from '../../process/launcher';
import { probeCurrentUid, resolveIsolation } from '../../process/privilege';
import { createCliDriverFactory } from '../cliDriver';
import { DevelopmentUsageJournal } from '../developmentUsageJournal';
import { DevelopmentAgentUsage } from '../developmentAgentUsage';
import { developmentIntentDigest } from '../developmentStartIntent';
import type { AgentSpec } from '../driver';

const roots: string[] = [], journals: DevelopmentUsageJournal[] = [];
afterEach(() => { for (const j of journals.splice(0)) j.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); resetOpencodeBinaryVersions(); resetOpencodeProbes(); });
const id = (n: number) => `019f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const stream = (line?: string) => new ReadableStream<Uint8Array>({ start(c) { if (line) c.enqueue(new TextEncoder().encode(line + '\n')); c.close(); } });
export function nativeProducerFixture(initialResume: boolean, registration?: DevelopmentUsageRegistration, actualModel = { provider: 'actual-provider', model: 'actual-model' }) {
  const directory = mkdtempSync(join(tmpdir(), 'cs-native-driver-turns-')); roots.push(directory);
  const path = join(directory, 'native.db'), context = { runtimeTaskId: registration?.runtimeTaskId ?? TaskIdSchema.parse(id(3)), workspaceTaskId: registration?.identity.taskId ?? TaskIdSchema.parse(id(2)), projectId: registration?.identity.projectId ?? ProjectIdSchema.parse(id(1)), podUid: registration?.podUid ?? 'controlled-original-pod' };
  mkdirSync(join(directory, 'journal'), { mode: 0o700 });
  const journal = new DevelopmentUsageJournal(join(directory, 'journal'), context, randomUUID()); journals.push(journal);
  const intent: DevelopmentUsageAdmission['intent'] = { version: 1, identity: { projectId: context.projectId, taskId: context.workspaceTaskId,
    executionId: context.runtimeTaskId, agentId: registration?.identity.agentId ?? id(4), sourceKind: 'development-agent', executionGeneration: 1 },
    profileId: registration?.profileId ?? id(5), profileRevision: registration?.profileRevision ?? 2, launch: { protocol: 'opencode', binaryPath: '/bin/opencode', extraArgs: [], isSandbox: false, model: actualModel.provider + '/' + actualModel.model },
    permission: 'full', mode: 'interactive', initialPrompt: 'first', cwd: null, resumeSessionId: initialResume ? 'root' : null, systemPrompt: null,
    mcp: [], nativeUsageLineageKey: 'controlled-original-lineage', nativeSource: { version: 2 } };
  const draft = { intent, digestNonce: 'a'.repeat(64) }, admission = DevelopmentUsageAdmissionSchema.parse({ ...draft, key: { executionId: context.runtimeTaskId,
    journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest(draft) } });
  if (registration) registration.key = admission.key;
  journal.reserve(admission); const usage = new DevelopmentAgentUsage(journal, admission, false);
  const journalPath = join(directory, 'journal', 'executions.sqlite');
  const readonly = () => new Database(journalPath, { readonly: true });
  const initialize = () => { if (existsSync(path)) return; const db = new Database(path); db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,time_created INTEGER); CREATE INDEX session_parent ON session(parent_id,id);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    CREATE INDEX part_session ON part(session_id,id);`); db.close(); };
  const add = (n: number, rootBirth = Date.now()) => { initialize(); const db = new Database(path); db.transaction(() => {
    db.query('INSERT OR IGNORE INTO session VALUES(?,?,?)').run('root', null, rootBirth);
    db.query('INSERT INTO message VALUES(?,?,?)').run('message-' + n, 'root', JSON.stringify({ role: 'assistant', providerID: actualModel.provider, modelID: actualModel.model }));
    db.query('INSERT INTO part VALUES(?,?,?,?,?)').run('step-' + n, 'root', 'message-' + n, Date.now(),
      JSON.stringify({ type: 'step-finish', tokens: { input: 11 + n, output: 13, reasoning: 3, cache: { read: 5, write: 7 } } }));
  })(); db.close(); };
  if (initialResume) add(0, Date.now() - 60_000);
  return { directory, path, context, actualModel, journal, journalPath, readonly, admission, usage, initialize, add };
}

export async function captureNativeProducerTurns(f: ReturnType<typeof nativeProducerFixture>, initialResume: boolean, options: { acknowledge?: boolean } = {}) {
  recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
  const checkpoints: DevelopmentNativeTurnInput[] = [], headers: string[] = [], commands: string[][] = [], legacy: unknown[] = [];
  let modelTurns = 0, bootstrapTurns = 0;
  const launcher = { ...createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) }), processEnv: {}, workerHome: f.directory, logger: noopLogger }),
    spawnPiped: (spawn: { cmd: string[]; env: Record<string, string>; cwd: string }): PipedProcess => {
      commands.push(spawn.cmd); expect(spawn.env.OPENCODE_DB).toBe(f.path); expect(spawn.cwd).toBe(f.directory);
      let line: string | undefined;
      if (spawn.cmd.includes('db')) { bootstrapTurns++; expect(spawn.cmd).toEqual(['/bin/opencode', 'db', 'SELECT 1', '--format', 'json']); f.initialize(); line = '[{"1":1}]'; }
      else {
        const read = f.readonly(); try {
          const row = read.query<{ document: string }, [number]>('SELECT document FROM development_native_turn_checkpoints WHERE turn_index=?').get(modelTurns)!;
          expect(row).toBeDefined(); const checkpoint = JSON.parse(row.document); checkpoints.push(checkpoint);
          expect(checkpoint.turnIndex).toBe(modelTurns); expect(checkpoint.key).toEqual(f.admission.key); expect(checkpoint.podUid).toBe(f.context.podUid);
          expect(checkpoint.store.state).toBe('observed'); expect(checkpoint.resumeSessionId).toBe(modelTurns > 0 || initialResume ? 'root' : null);
          const baselines = read.query<{ count: number }, [string]>("SELECT count(*) AS count FROM development_native_passes WHERE turn=? AND state='eof' AND json_extract(identity_json,'$.phase')='baseline'").get(checkpoint.turn)!;
          expect(baselines.count).toBe(modelTurns > 0 || initialResume ? 1 : 0);
          if (modelTurns === 0) expect(() => f.journal.nativeBeginTurn(f.admission.key,
            { ...checkpoint, turn: 'cannot-skip-final', turnIndex: 1, resumeSessionId: 'root' })).toThrow();
          headers.push(read.query<{ header: string }, []>('SELECT header FROM development_admissions').get()!.header);
        } finally { read.close(); }
        expect(spawn.cmd.includes('--session')).toBe(modelTurns > 0 || initialResume);
        f.add(modelTurns + 1); modelTurns++;
        line = JSON.stringify({ type: 'step_finish', sessionID: 'root', timestamp: Date.now(), part: { id: 'step-' + modelTurns, sessionID: 'root', messageID: 'message-' + modelTurns,
          type: 'step-finish', tokens: { input: 11 + modelTurns, output: 13, reasoning: 3, cache: { read: 5, write: 7 } } } });
      }
      return { pid: 0, stdout: stream(line), stderr: stream(), exited: Promise.resolve(0), exitCode: 0, signalCode: null } as PipedProcess;
    } };
  const spec: AgentSpec = { agentId: f.admission.intent.identity.agentId, compute: 'validation-only', profileRevision: f.admission.intent.profileRevision, launch: f.admission.intent.launch,
    permission: 'full', mode: 'interactive', initialPrompt: 'first', resumeSessionId: initialResume ? 'root' : undefined,
    mcp: [], usageObservationsV1: 1, nativeUsageTreeV1: 1, developmentNativePagesV2: 2, nativeUsageLineageKey: f.admission.intent.nativeUsageLineageKey };
  const driver = createCliDriverFactory({ which: () => '/bin/opencode' }); expect(driver.developmentNativePagesV2).toBe(2);
  const run = driver.forProtocol('opencode').start(spec, { cwd: f.directory, env: { HOME: f.directory, OPENCODE_DB: f.path }, launcher, logger: noopLogger,
    managed: { home: f.directory, runDir: join(f.directory, 'run') }, usageSink: (frame) => legacy.push(frame), developmentNativeProducer: f.usage.nativeProducer });
  const events: AgentEvent[] = []; let ready!: () => void; const waiting = new Promise<void>((r) => { ready = r; });
  const pump = (async () => { for await (const event of run.events) { events.push(event); f.usage.observe(event); if (event.type === 'status' && event.status === 'waiting') ready(); } })();
  await waiting; expect(modelTurns).toBe(1); const before = f.journal.info(f.admission.key).receipt!.lastSequence; expect(before).toBeGreaterThan(0);
  const first = f.journal.read(f.admission.key, 0).events; expect(first.every((e) => e.capture.version === 2)).toBe(true);
  const original = checkpoints[0]!, next = { ...original, turn: 'invalid-successor', turnIndex: 1, resumeSessionId: 'root', observedAt: new Date().toISOString() };
  for (const changed of [{ resumeSessionId: 'different-root' }, { turnIndex: 2 }, { turnIndex: 0 },
    { observedAt: new Date(Date.parse(original.observedAt) - 1).toISOString() },
    { store: { ...original.store, sourceEpoch: 'different-original-epoch' } }]) {
    expect(() => f.journal.nativeBeginTurn(f.admission.key, { ...next, ...changed })).toThrow();
  }
  expect(() => f.journal.nativeBeginTurn({ ...f.admission.key, incarnation: randomUUID() }, next)).toThrow();
  expect(() => f.journal.nativeBeginTurn(f.admission.key, { ...original, observedAt: new Date(Date.parse(original.observedAt) + 1).toISOString() })).toThrow();
  expect(() => f.journal.nativeTurnOwner(f.admission.key, { turn: original.turn, turnIndex: original.turnIndex,
    observedAt: original.observedAt, store: original.store, rootSessionId: 'replacement-root' }, Date.now())).toThrow();
  const unchanged = f.readonly(); try { expect(unchanged.query<{ total: number }, []>('SELECT count(*) AS total FROM development_native_turn_checkpoints').get()!.total).toBe(1); }
  finally { unchanged.close(); }
  expect(modelTurns).toBe(1);
  expect(f.journal.info(f.admission.key).receipt?.interruption).toBeNull();
  await run.send('second'); expect(events.filter(event => event.type === 'error').map(event => event.error)).toEqual([]); expect(modelTurns).toBe(2); expect(bootstrapTurns).toBe(2); expect(commands).toHaveLength(4);
  await run.cancel(); await pump;
  expect(legacy).toEqual([]); expect(events.some((e) => e.type === 'usage')).toBe(false); expect(events.at(-1)?.type).toBe('cancelled');
  expect(headers[1]).toBe(headers[0]); expect(checkpoints[1]?.resumeSessionId).toBe('root');
  const frames = f.journal.read(f.admission.key, 0).events; expect(frames.length).toBeGreaterThan(first.length);
  expect(frames.every((e) => e.capture.version === 2)).toBe(true); expect(f.journal.info(f.admission.key).receipt?.interruption).toBeNull();
  const read = f.readonly(); try {
    const passes = read.query<{ pass_id: string; turn: string; identity_json: string }, []>('SELECT pass_id,turn,identity_json FROM development_native_passes ORDER BY rowid').all();
    expect(passes.map((p) => JSON.parse(p.identity_json).phase)).toEqual(initialResume ? ['baseline', 'final', 'baseline', 'final'] : ['final', 'baseline', 'final']);
    const final = passes.at(-1)!; const retained = f.journal.nativePage(f.admission.key, final.pass_id, '0');
    expect(retained.baselineKind).toBe('resume'); expect(JSON.parse(retained.document).counts.steps).toBe(initialResume ? '3' : '2');
    expect(JSON.parse(retained.document).steps.at(-1)?.usage).toEqual({ input: '13', output: '16', cacheRead: '5', cacheWrite: '7' });
    const checkpoint = read.query<{ document: string }, [number]>('SELECT document FROM development_native_turn_checkpoints WHERE turn_index=?').get(1)!;
    expect(JSON.parse(checkpoint.document).previousFinalPassId).toBe(passes.find((p) => JSON.parse(p.identity_json).phase === 'final')!.pass_id);
    if (options.acknowledge !== false) f.journal.acknowledge(f.admission.key, f.journal.info(f.admission.key).receipt!.lastSequence); expect(f.journal.nativePage(f.admission.key, final.pass_id, '0')).toEqual(retained);
    const reopened = new DevelopmentUsageJournal(join(f.directory, 'journal'), f.context, randomUUID()); journals.push(reopened);
    expect(reopened.nativePage(f.admission.key, final.pass_id, '0')).toEqual(retained);
    expect(() => reopened.nativeBeginTurn(f.admission.key, { ...checkpoints[1]!, turn: 'forbidden-restart' })).toThrow();
  } finally { read.close(); }
  return { frames, checkpoints, events };
}
