// RFC-034: real native files, immutable source observations, private sink and final spawn environment.
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DevelopmentRunnerUsageCaptureSchema, RunnerUsageCaptureSchema, type AgentEvent, type DevelopmentRunnerUsageCapture } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createDevelopmentNativeUsageCapture, unsupportedDevelopmentNativeUsageCapture } from '../drivers/usage/developmentNativeCapture';
import { createOpencodeUsageNormalizer } from '../drivers/usage/opencodeModel';
import { createOpencodeDriver } from '../drivers/opencode/driver';
import { recordOpencodeBinaryVersion, resetOpencodeBinaryVersions } from '../drivers/opencode/versionRegistry';
import { resetOpencodeProbes } from '../drivers/opencode/probe';
import { ChainedAgentRun } from '../drivers/chainedRun';
import { parseEvent } from '../drivers/opencode/events';
import type { DriverAgentSpec } from '../contract/agentDriver';
import type { PreparedRuntime } from '../drivers/cliRuntimeAdapter';
import { createFakeProcessHost } from './fakeProcessHost';

const roots: string[] = [], at = 1790726400000;
afterEach(() => { resetOpencodeBinaryVersions(); resetOpencodeProbes(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function file() { const root = mkdtempSync(join(tmpdir(), 'cs-source-capture-')); roots.push(root); return join(root, 'native.db'); }
function seed(path: string, input = 10, model = 'actual-model') {
  const db = new Database(path);
  db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT)');
  db.query('INSERT INTO session VALUES(?,?)').run('root', null);
  db.query('INSERT INTO message VALUES(?,?,?)').run('message', 'root', JSON.stringify({ role: 'assistant', providerID: 'actual-provider', modelID: model }));
  db.query('INSERT INTO part VALUES(?,?,?,?,?)').run('step', 'root', 'message', at, JSON.stringify({ type: 'step-finish', tokens: { input, output: 3, cache: { read: 2, write: 0 } } })); db.close();
}
function capture(path: string, resumeSessionId?: string) { let revision = 0; return createDevelopmentNativeUsageCapture({ lineageKey: 'expected-namespace', turn: 'turn', turnIndex: 0, resumeSessionId, nextRevision: () => ++revision }, { OPENCODE_DB: path }); }
const raw = JSON.stringify({ type: 'step_finish', sessionID: 'root', timestamp: at, part: { id: 'step', sessionID: 'root', messageID: 'message', tokens: { input: 10, output: 3, cache: { read: 2, write: 0 } } } });
const spec: DriverAgentSpec = { agentId: 'source-agent', compute: 'named compute', profileRevision: 1, launch: { protocol: 'opencode', binaryPath: '/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full', mode: 'oneshot', initialPrompt: 'private-prompt', mcp: [], usageObservationsV1: 1, nativeUsageTreeV1: 1, nativeUsageLineageKey: 'expected-namespace', developmentNativeSourceV1: 1 };
async function collect(events: AsyncIterable<AgentEvent>) { const result: AgentEvent[] = []; for await (const event of events) result.push(event); return result; }

test('a fresh pending source creates no upstream DB and only actual final creation proves this execution', () => {
  const path = file(), c = capture(path), begin = c.begin(at);
  expect(begin.nativeSource).toMatchObject({ stage: 'begin', beginStore: { state: 'pending' }, scope: 'unverified' });
  expect(existsSync(path)).toBe(false); expect(existsSync(path + '.crewstation-usage.sqlite')).toBe(false);
  seed(path); c.observeSession('root'); expect(c.includesRecord('root', 'step')).toBe(true);
  const frames = c.finish('root', at + 1), end = frames.at(-1)!;
  expect(end.nativeSource).toMatchObject({ stage: 'finish', continuity: 'new', scope: 'execution-local', finalStore: { state: 'observed' }, issues: [] });
  expect(end.nativeProof?.state).toBe('complete'); expect(frames[0]!.measurements[0]!.usage.input).toBe('10');
  expect(RunnerUsageCaptureSchema.safeParse(end).success).toBe(false); expect(DevelopmentRunnerUsageCaptureSchema.safeParse(end).success).toBe(true);
  expect(frames[0]!.nativeSource).toBeUndefined(); expect(JSON.stringify(frames)).not.toContain(path);
});
test('healthy resume keeps store identity and ordering while historical revisions remain separately attributable', () => {
  const path = file(); seed(path); const c = capture(path, 'root'), begin = c.begin(at);
  expect(c.includesRecord('root', 'step')).toBe(false);
  const db = new Database(path); db.query('UPDATE part SET data=?').run(JSON.stringify({ type: 'step-finish', tokens: { input: 15, output: 3, cache: { read: 2, write: 0 } } })); db.close();
  const frames = c.finish('root', at + 1), end = frames.at(-1)!;
  expect(end.nativeSource?.finalStore).toEqual(begin.nativeSource?.beginStore); expect(end.nativeSource?.continuity).toBe('same');
  expect(end.nativeProof).toMatchObject({ state: 'partial', priorRevisionGap: true });
  expect(end.nativeProof!.order!.sequence).toBeGreaterThan(begin.nativeProof!.baseline.order!.sequence);
  expect(frames.flatMap((f) => f.measurements)).toEqual([]);
  expect(frames.find((f) => f.nativeBaseline)?.nativeBaseline?.steps[0]).toMatchObject({ before: { usage: { input: '10' } }, after: { usage: { input: '15' } }, afterObserved: true });
});
test('a missing resume baseline and a replaced store cannot certify complete even with identical native IDs', () => {
  const path = file(), missing = capture(path, 'root'); missing.begin(at); seed(path);
  const absent = missing.finish('root', at + 1);
  expect(absent.at(-1)?.nativeSource?.continuity).toBe('unverified'); expect(absent.flatMap((f) => f.measurements)).toEqual([]);
  expect(absent.at(-1)?.nativeProof?.issues).toContain('native-baseline-unavailable');
  const c = capture(path), before = c.begin(at), replacement = file(); seed(replacement, 20); renameSync(replacement, path);
  const end = c.finish('root', at + 1).at(-1)!;
  expect(end.nativeProof?.state).toBe('partial'); expect(end.nativeSource?.continuity).toBe('changed');
  expect(end.nativeSource?.issues).toContain('native-source-changed'); expect(end.nativeSource?.finalStore).not.toEqual(before.nativeSource?.beginStore);
});
test('unavailable paths and unsupported adapters emit explicit final source gaps instead of complete zeros', () => {
  let revision = 0; const input = { lineageKey: 'expected', turn: 'turn', turnIndex: 0, nextRevision: () => ++revision };
  const missing = createDevelopmentNativeUsageCapture(input, { OPENCODE_DB: ':memory:' }); missing.begin(at);
  expect(missing.finish(undefined, at + 1).at(-1)).toMatchObject({ nativeProof: { state: 'partial' }, nativeSource: { stage: 'finish', finalStore: { state: 'unavailable' }, issues: ['native-source-path-unavailable'] } });
  const unsupported = unsupportedDevelopmentNativeUsageCapture(input);
  expect(unsupported.begin(at).nativeSource?.stage).toBe('begin'); expect(unsupported.includesRecord('any', 'id')).toBe(true); unsupported.observeSession('root');
  expect(unsupported.finish('root', at + 1)).toMatchObject([{ nativeProof: { state: 'unsupported' }, nativeSource: { stage: 'finish', issues: ['native-source-unsupported'] } }]);
});
test('OpenCode opts into private source frames and keeps stdout numeric evidence and ordinary events', async () => {
  recordOpencodeBinaryVersion('/bin/opencode', '1.18.29'); const path = file(); seed(path);
  const host = createFakeProcessHost([{ stdout: [raw] }]), frames: DevelopmentRunnerUsageCapture[] = [], env = { HOME: '/unchanged', OPENCODE_DB: path };
  const events = await collect(createOpencodeDriver(() => '/bin/opencode').start(spec, { cwd: roots.at(-1)!, runDir: join(roots.at(-1)!, 'run'), env, host, logger: noopLogger, usageSink: (frame) => { frames.push(DevelopmentRunnerUsageCaptureSchema.parse(frame)); if (frame.nativeSource?.stage === 'begin') expect(host.spawns).toHaveLength(0); } }).events);
  expect(frames.filter((f) => f.nativeSource).map((f) => f.nativeSource?.stage)).toEqual(['begin', 'finish']);
  expect(frames.at(-1)?.nativeProof?.state).toBe('complete'); expect(frames.flatMap((f) => f.measurements)[0]?.actualModel?.model).toBe('actual-model');
  expect(events.some((e) => e.type === 'usage')).toBe(false); expect(events.at(-1)?.type).toBe('completed');
  expect(host.spawns[0]?.env.HOME).toBe('/unchanged'); expect(host.spawns[0]?.env.OPENCODE_DB).toBe(path); expect(env).toEqual({ HOME: '/unchanged', OPENCODE_DB: path });
});
test('final plan environment controls source and model reads and final evidence is persisted before directory disposal', async () => {
  const parent = file(), child = file(); seed(parent, 99, 'parent-model'); seed(child, 10, 'child-model');
  const host = createFakeProcessHost([{ stdout: [raw] }]), frames: DevelopmentRunnerUsageCapture[] = [];
  const prepared: PreparedRuntime = { plan: () => ({ cmd: ['/bin/opencode'], env: { HOME: '/final-home', OPENCODE_DB: child }, stdin: { mode: 'ignore' } }), parseEvent, normalizeUsage: createOpencodeUsageNormalizer({ OPENCODE_DB: parent }), nativeUsageCapture: createDevelopmentNativeUsageCapture, detectSessionNotFound: () => false,
    dispose: () => { expect(frames.at(-1)?.nativeSource?.stage).toBe('finish'); rmSync(child); } };
  const events = await collect(new ChainedAgentRun(spec, { cwd: roots.at(-1)!, env: { OPENCODE_DB: parent }, host, logger: noopLogger, usageSink: (f) => frames.push(f) }, prepared, 'opencode').events);
  expect(frames[0]?.nativeSource?.plannedPathDigest).toBe(createHash('sha256').update(child).digest('hex'));
  expect(frames.flatMap((f) => f.measurements)[0]?.actualModel?.model).toBe('child-model'); expect(host.spawns[0]?.env.OPENCODE_DB).toBe(child);
  expect(events.at(-1)?.type).toBe('completed'); expect(existsSync(child)).toBe(false); expect(existsSync(parent)).toBe(true);
});

test('cancellation after durable begin but before spawn persists a final gap without launching a model', async () => {
  const path = file(), host = createFakeProcessHost([{ stdout: [raw] }]), frames: DevelopmentRunnerUsageCapture[] = [];
  const prepared: PreparedRuntime = { plan: () => ({ cmd: ['/bin/opencode'], env: { OPENCODE_DB: path }, stdin: { mode: 'ignore' } }), parseEvent, normalizeUsage: createOpencodeUsageNormalizer({ OPENCODE_DB: path }), nativeUsageCapture: createDevelopmentNativeUsageCapture, detectSessionNotFound: () => false, dispose: () => {} };
  const run: ChainedAgentRun = new ChainedAgentRun(spec, { cwd: roots.at(-1)!, env: {}, host, logger: noopLogger, usageSink: (frame) => { frames.push(frame); if (frame.nativeSource?.stage === 'begin') queueMicrotask(() => { void run.cancel(); }); } }, prepared, 'opencode');
  const events = await collect(run.events); expect(host.spawns).toHaveLength(0); expect(events.at(-1)?.type).toBe('cancelled');
  expect(frames.at(-1)).toMatchObject({ nativeProof: { state: 'partial' }, nativeSource: { stage: 'finish', continuity: 'unverified' } });
  expect(frames.at(-1)?.nativeProof?.issues.toSorted()).toEqual(['native-process-not-started', 'native-root-unavailable']);
});
