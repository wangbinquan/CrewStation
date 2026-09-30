import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DevelopmentUsageAdmissionSchema, ProjectIdSchema, StartAgentCommandSchema, TaskIdSchema, type AgentEvent, type RunnerEvent } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createAgentSupervisor } from '../agentSupervisor';
import { DevelopmentUsageJournal } from '../developmentUsageJournal';
import { developmentIntentDigest } from '../developmentStartIntent';
import { createAgentEventFactory, type AgentDriver } from '../driver';
import { createEventQueue } from '../eventQueue';
import { BeforeStartRunner } from '../../beforeStart/beforeStartRunner';
import { createWorkdirPaths } from '../../files/workdirPath';
import type { ProcessLauncher } from '../../process/launcher';

const resource = (n: number) => '019f0000-0000-7000-8000-' + String(n).padStart(12, '0');
const context = { runtimeTaskId: TaskIdSchema.parse(resource(3)), workspaceTaskId: TaskIdSchema.parse(resource(2)), projectId: ProjectIdSchema.parse(resource(1)), podUid: 'actual-test-pod' };
const directories: string[] = [], journals: DevelopmentUsageJournal[] = [];
const cleanup: Array<() => Promise<void>> = [];
function signal<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((accept) => { resolve = accept; }); return { promise, resolve }; }
async function directory() { const path = await mkdtemp(join(tmpdir(), 'cs-durable-stop-')); directories.push(path); return path; }
function open(path: string) { const journal = new DevelopmentUsageJournal(path, context, randomUUID()); journals.push(journal); return journal; }
function admission(journal: DevelopmentUsageJournal) {
  const intent = { version: 1 as const, identity: { sourceKind: 'development-agent' as const, projectId: context.projectId, taskId: context.workspaceTaskId, executionId: context.runtimeTaskId, executionGeneration: 1 as const, agentId: resource(4) },
    profileId: resource(5), profileRevision: 2, launch: { protocol: 'opencode' as const, binaryPath: '/fixture/opencode', extraArgs: [], isSandbox: false }, permission: 'edit' as const, mode: 'interactive' as const,
    initialPrompt: 'fixture prompt', cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'expected-source-constraint' };
  const base = { intent, digestNonce: 'a'.repeat(64) };
  return DevelopmentUsageAdmissionSchema.parse({ ...base, key: { executionId: context.runtimeTaskId, journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest(base) } });
}
async function harness(options: { pendingCwd?: boolean; pendingHook?: boolean; ordinary?: boolean } = {}) {
  const root = await directory(); await mkdir(join(root, 'numeric'), { mode: 0o700 });
  const journal = open(join(root, 'numeric')), a = admission(journal);
  const cwd = signal<void>(), hook = signal<void>(), hookEntered = signal<void>(), started = signal<void>(), terminal = signal<void>(), released = signal<void>();
  const events: RunnerEvent[] = [], stream = createEventQueue<AgentEvent>();
  let hooks = 0, models = 0, cancels = 0, sends = 0, alive = false;
  const launcher: ProcessLauncher = { isolation: { enabled: false, uid: 1, gid: 1, wrap: (args) => args }, baseEnv: (extra) => ({ ...extra }), chownToWorker: async () => {},
    spawnPiped: () => { throw new Error('no external process allowed'); }, spawnWithStdin: () => { throw new Error('no external process allowed'); }, spawnWithTerminal: () => { throw new Error('no external process allowed'); } };
  const emit = (event: RunnerEvent) => { events.push(event); if (event.kind === 'agent' && ['completed', 'error', 'cancelled'].includes(event.event.type)) terminal.resolve(); };
  class Hooks extends BeforeStartRunner { override release(agentId: string) { super.release(agentId); released.resolve(); } }
  const before = new Hooks({ baseDir: join(root, 'hooks'), launcher, interpreters: { list: [], extensionFor: () => { throw new Error('no script'); }, argvFor: () => { throw new Error('no script'); } }, logger: noopLogger, emit,
    afterSteps: async () => { hooks++; hookEntered.resolve(); if (options.pendingHook) await hook.promise; } });
  const driver: AgentDriver = { protocol: 'opencode', start: (spec, launch) => {
    models++; alive = true; const event = createAgentEventFactory(spec.agentId); stream.push(event('started')); started.resolve();
    return { events: stream, send: async () => { sends++; }, cancel: async () => {
      cancels++; alive = false;
      if (!stream.closed) { launch.usageSink?.({ version: 1, measurements: [], diagnostics: ['not-measured'] }, new Date().toISOString()); stream.push(event('cancelled', { result: { durationMs: 0 } })); stream.close(); }
    } };
  } };
  const paths = await createWorkdirPaths(root);
  const supervisor = createAgentSupervisor({ developmentUsage: options.ordinary ? undefined : journal, drivers: { forProtocol: () => driver }, beforeStart: before, launcher, logger: noopLogger, emit,
    paths: { ...paths, resolveCwd: async (path) => { if (options.pendingCwd) await cwd.promise; return paths.resolveCwd(path); } } });
  const command = StartAgentCommandSchema.parse({ id: 'start-fixture', type: 'startAgent', agentId: a.intent.identity.agentId, compute: 'fixture-name', profileRevision: a.intent.profileRevision, launch: a.intent.launch,
    permission: a.intent.permission, mode: a.intent.mode, initialPrompt: a.intent.initialPrompt, beforeStart: { profile: a.intent.profileId, revision: a.intent.profileRevision, contentHash: 'fixture', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false }, processAttemptId: 'fixture-attempt',
    ...(options.ordinary ? {} : { developmentUsage: a }) });
  cleanup.push(async () => { cwd.resolve(); hook.resolve(); await supervisor.cancelAll(); });
  return { root, journal, a, command, supervisor, cwd, hook, hookEntered, started, terminal, released, stream, before, events, counts: () => ({ hooks, models, cancels, sends, alive }) };
}
afterEach(async () => { for (const end of cleanup.splice(0)) await end(); for (const journal of journals.splice(0)) journal.close(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('durable original-key development stop', () => {
  test('stop before a Start is durable, idempotent and survives a Runner incarnation change', async () => {
    const path = await directory(), journal = open(path), a = admission(journal);
    expect(journal.requestStop(a, context.podUid)).toMatchObject({ state: 'prevented', receipt: { phase: 'finished', result: 'cancelled', finalThrough: 0 } });
    expect(journal.reserve(a).created).toBe(false); expect(journal.permitLaunch(a.key)).toBe(false);
    const restarted = open(path);
    expect(restarted.requestStop(a, context.podUid).state).toBe('prevented');
    expect(restarted.reserve(a).created).toBe(false);
    // Transport zero is not a native Token-zero proof.
    expect(restarted.read(a.key, 0).events).toEqual([]);
  });
  test('a launch permit makes registered ambiguous; stop never claims it was prevented', async () => {
    const journal = open(await directory()), a = admission(journal); journal.reserve(a); expect(journal.permitLaunch(a.key)).toBe(true);
    expect(journal.requestStop(a, context.podUid).state).toBe('unknown');
    expect(journal.stopStatus(a.key, true).state).toBe('stopping');
    journal.finish(a.key, 'cancelled'); expect(journal.stopStatus(a.key, false).state).toBe('finished');
  });
  test('all interrupted finished rows lack exit proof, including a masked missing-terminal', async () => {
    for (const first of ['missing-terminal', 'journal-unavailable'] as const) {
      const path = await directory(), journal = open(path), a = admission(journal); journal.reserve(a); journal.permitLaunch(a.key);
      journal.interrupt(a.key.executionId, first); journal.interrupt(a.key.executionId, 'missing-terminal'); journal.finish(a.key, 'error');
      expect(journal.info(a.key).receipt).toMatchObject({ phase: 'finished', result: 'error', interruption: first });
      expect(journal.requestStop(a, context.podUid).state).toBe('unknown');
      expect(open(path).requestStop(a, context.podUid).state).toBe('unknown');
    }
  });
  test('legacy registered rows without controls are not given a never-started proof', async () => {
    const path = await directory(), journal = open(path), a = admission(journal); journal.reserve(a);
    const db = new Database(join(path, 'executions.sqlite')); db.exec('DELETE FROM development_start_controls'); db.close();
    expect(journal.requestStop(a, context.podUid).state).toBe('unknown'); expect(journal.permitLaunch(a.key)).toBe(false);
    expect(open(path).requestStop(a, context.podUid).state).toBe('unknown');
  });
  test('wrong intent or Pod cannot create a stop, and failed control writes roll back the full first admission', async () => {
    const path = await directory(), journal = open(path), a = admission(journal);
    expect(() => journal.requestStop(a, 'replacement-pod')).toThrow('原意图或Pod');
    expect(() => journal.requestStop({ ...a, intent: { ...a.intent, initialPrompt: 'different' } }, context.podUid)).toThrow('原意图或Pod');
    expect(journal.info().receipt).toBeNull();
    const db = new Database(join(path, 'executions.sqlite')); db.exec("CREATE TRIGGER stop_insert_failure BEFORE INSERT ON development_start_controls BEGIN SELECT RAISE(FAIL, 'control disk failure'); END;");
    expect(() => journal.requestStop(a, context.podUid)).toThrow('control disk failure'); expect(journal.info().receipt).toBeNull();
    db.exec('DROP TRIGGER stop_insert_failure'); db.close();
    expect(journal.requestStop(a, context.podUid).state).toBe('prevented');
  });
  test('stop preserves an undurable known error instead of rewriting it to cancellation', async () => {
    const path = await directory(), journal = open(path), a = admission(journal); journal.reserve(a);
    const db = new Database(join(path, 'executions.sqlite')); db.exec("CREATE TRIGGER finish_disk_failure BEFORE UPDATE OF phase ON executions BEGIN SELECT RAISE(FAIL, 'finish disk failure'); END;");
    journal.finish(a.key, 'error'); db.exec('DROP TRIGGER finish_disk_failure'); db.close();
    expect(journal.requestStop(a, context.podUid)).toMatchObject({ state: 'unknown', receipt: { phase: 'finished', result: 'error', interruption: 'journal-unavailable' } });
    expect(journal.info(a.key).receipt).toMatchObject({ result: 'error', interruption: 'journal-unavailable' });
    expect(open(path).requestStop(a, context.podUid).state).toBe('unknown');
  });
  test('a stop before launch keeps the original interrupted transport across restart', async () => {
    const path = await directory(), journal = open(path), a = admission(journal); journal.reserve(a);
    journal.capture(a.key, { version: 1, measurements: [], diagnostics: ['not-measured'] }, new Date().toISOString());
    journal.interrupt(a.key.executionId, 'journal-unavailable');
    expect(journal.requestStop(a, context.podUid)).toMatchObject({ state: 'prevented', receipt: { interruption: 'journal-unavailable', finalThrough: null, lastSequence: 1 } });
    expect(open(path).requestStop(a, context.podUid)).toMatchObject({ state: 'prevented', receipt: { interruption: 'journal-unavailable', finalThrough: null, lastSequence: 1 } });
  });
  test('a pending resolveCwd is cancelled without waiting and never runs a Hook or model when resumed', async () => {
    const h = await harness({ pendingCwd: true }), starting = h.supervisor.start(h.command);
    expect(h.supervisor.size).toBe(1);
    expect((await h.supervisor.stopDevelopmentAgent!(h.a, context.podUid)).state).toBe('prevented');
    expect(h.counts()).toMatchObject({ hooks: 0, models: 0 }); h.cwd.resolve(); await starting; await h.terminal.promise;
    expect(h.counts()).toMatchObject({ hooks: 0, models: 0 }); expect(h.supervisor.size).toBe(0);
    await h.supervisor.start({ ...h.command, id: 'lost-ack-replay' }); expect(h.counts().models).toBe(0);
  });
  test('a stop before delivery blocks late and duplicate Start without preparing materials', async () => {
    const h = await harness(); expect((await h.supervisor.stopDevelopmentAgent!(h.a, context.podUid)).state).toBe('prevented');
    await Promise.all([h.supervisor.start(h.command), h.supervisor.start({ ...h.command, id: 'replay' })]);
    expect(h.counts()).toMatchObject({ hooks: 0, models: 0 }); expect(h.supervisor.size).toBe(0);
  });
  test('stop during a Hook holds the durable gate and prevents the driver after the Hook settles', async () => {
    const h = await harness({ pendingHook: true }); await h.supervisor.start(h.command); await h.hookEntered.promise;
    const stopping = h.supervisor.stopDevelopmentAgent!(h.a, context.podUid);
    expect(h.journal.stopStatus(h.a.key, true).state).toBe('prevented'); h.hook.resolve(); await stopping; await h.released.promise;
    expect(h.counts()).toMatchObject({ hooks: 1, models: 0 }); expect(existsSync(h.before.homeFor(h.a.intent.identity.agentId))).toBe(false);
  });
  test('live cancel copies the last capture before terminal/release and duplicate Start never spawns twice', async () => {
    const h = await harness(); await h.supervisor.start(h.command); await h.started.promise;
    await h.supervisor.start({ ...h.command, id: 'ack-lost' }); expect(h.counts().models).toBe(1);
    await h.supervisor.stopDevelopmentAgent!(h.a, context.podUid); await h.released.promise;
    expect(h.counts()).toMatchObject({ models: 1, cancels: 1, alive: false });
    expect(h.journal.stopStatus(h.a.key, false)).toMatchObject({ state: 'finished', receipt: { lastSequence: 1, finalThrough: 1 } });
    expect(h.journal.read(h.a.key, 0).events).toHaveLength(1); expect(existsSync(h.before.homeFor(h.a.intent.identity.agentId))).toBe(false);
  });
  test('a failed numeric stream retains cancellation of its unproven live child and remains unknown', async () => {
    const h = await harness(); await h.supervisor.start(h.command); await h.started.promise;
    h.stream.fail(new Error('fixture stream failure')); await h.released.promise;
    expect(h.counts().alive).toBe(true); expect(h.journal.info(h.a.key).receipt).toMatchObject({ phase: 'finished', interruption: 'missing-terminal' });
    expect((await h.supervisor.stopDevelopmentAgent!(h.a, context.podUid)).state).toBe('unknown');
    expect(h.counts()).toMatchObject({ cancels: 1, alive: false });
  });
  test('launch-control write failure cannot invoke the driver or claim a proven finish', async () => {
    const h = await harness(), db = new Database(join(h.root, 'numeric', 'executions.sqlite'));
    db.exec("CREATE TRIGGER launch_disk_failure BEFORE UPDATE OF launch_permitted ON development_start_controls BEGIN SELECT RAISE(FAIL, 'launch disk failure'); END;");
    await h.supervisor.start(h.command); await h.released.promise;
    expect(h.counts()).toMatchObject({ models: 0 }); expect(h.journal.info(h.a.key).receipt?.interruption).toBe('journal-unavailable');
    db.exec('DROP TRIGGER launch_disk_failure'); db.close();
    expect((await h.supervisor.stopDevelopmentAgent!(h.a, context.podUid)).state).toBe('unknown');
  });
  test('ordinary legacy start/message/cancel retain their existing route without numeric registration', async () => {
    const h = await harness({ ordinary: true }); await h.supervisor.start(h.command); await h.started.promise;
    await h.supervisor.send(h.a.intent.identity.agentId, 'second message'); await h.supervisor.cancel(h.a.intent.identity.agentId); await h.released.promise;
    expect(h.counts()).toMatchObject({ models: 1, sends: 1, cancels: 1, alive: false }); expect(h.journal.info().receipt).toBeNull();
  });
});
