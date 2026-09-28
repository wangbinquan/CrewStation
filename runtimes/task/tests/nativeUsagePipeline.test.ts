// RFC-034: exercise native proof persistence and backpressure through all three real queues.
import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCliAgentDriver, type CliRuntimeAdapter, type ProcessHost } from '@crewstation/agent-drivers';
import { StartAgentCommandSchema, type AgentEvent, type NativeUsageProof, type RunnerUsageCapture } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { businessAgentFactory } from '../src/agents/businessAgentFactory';
import { BusinessAgentSupervisor } from '../src/agents/businessAgentSupervisor';
import { BeforeStartRunner } from '../src/beforeStart/beforeStartRunner';
import { ExecutionJournal } from '../src/exec/executionJournal';
import { createWorkdirPaths } from '../src/files/workdirPath';
import { createProcessLauncher } from '../src/process/launcher';
import { resolveIsolation } from '../src/process/privilege';

const disposals: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const identity = { executionId: 'native-pipeline', attempt: 1, payloadDigest: 'd'.repeat(64) };
const at = '2026-09-29T00:00:00.000Z';
const frame = (nativeProof: NativeUsageProof): RunnerUsageCapture => ({ version: 1, measurements: [], diagnostics: [], nativeProof });

async function fixture(options: { large?: boolean; rejectPending?: boolean; oneshot?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cs-native-pipeline-'));
  disposals.push(() => rm(root, { force: true, recursive: true }));
  const limits = { outputBytes: 32 * 1024 * 1024, spoolBytes: 32 * 1024 * 1024, eventBytes: 256 * 1024 };
  await mkdir(join(root, 'journal'), { mode: 0o700 });
  await mkdir(join(root, 'home'), { mode: 0o700 });
  const journal = new ExecutionJournal(join(root, 'journal'), 'owner', limits); disposals.push(() => journal.close());
  const supervisor = new BusinessAgentSupervisor(journal, noopLogger), launched = deferred(), began = deferred(), prepared = deferred();
  const seenAtSpawn: string[][] = [], finalFrames: RunnerUsageCapture[] = [];
  let disposed = false;
  const readProofs = () => !journal.get(identity.executionId) ? [] : journal.replay(identity.executionId, 0, 1000).flatMap(({ frame }) => frame.type === 'agent' && frame.event.usageCapture?.nativeProof ? [frame.event.usageCapture.nativeProof.state] : []);
  const host: ProcessHost = {
    spawnPiped: () => { seenAtSpawn.push(readProofs()); launched.resolve(); return { pid: 123, stdout: new ReadableStream({ start(c) { c.close(); } }), stderr: new ReadableStream({ start(c) { c.close(); } }), exitCode: 0, signalCode: null, exited: Promise.resolve(0) }; },
    spawnWithStdin: () => { throw new Error('unexpected stdin spawn'); }, killTree: async () => {}, pumpLines: async () => {}, chownToWorker: async () => {}, which: (binary) => binary,
  };
  const adapter: CliRuntimeAdapter = { protocol: 'opencode', supportsResidentStream: false, prepare: async () => {
    prepared.resolve(); return { normalizeUsage: () => [], plan: () => ({ cmd: ['native-test'], env: {}, stdin: { mode: 'ignore' } }), parseEvent: () => null,
      detectSessionNotFound: () => false, dispose: () => { disposed = true; }, nativeUsageCapture: (input) => {
        const proof: NativeUsageProof = { contract: 'opencode-child-steps-v1', lineageKey: input.lineageKey, turn: input.turn, turnIndex: input.turnIndex,
          state: 'pending', root: 'root', observedAt: at, baseline: { kind: 'resume', fingerprint: 'before' }, fingerprint: null,
          sessions: 1, steps: 0, emitted: 0, baselineSteps: options.large ? 80 : 0, priorRevisionGap: false, issues: [] };
        return { begin: () => { began.resolve(); return frame(proof); }, includesRecord: () => true, observeSession: () => {}, finish: () => {
          finalFrames.length = 0;
          for (let offset = 0; offset < (options.large ? 80 : 0); offset += 2) finalFrames.push({ version: 1, measurements: [], diagnostics: [], nativeBaseline: {
            lineageKey: input.lineageKey, turn: input.turn, root: 'root', offset, steps: Array.from({ length: 2 }, (_, i) => {
              const step = { id: `step-${offset + i}`, sessionId: 'child', parentSessionId: 'root', ancestors: Array.from({ length: 64 }, (_, n) => String(n).padEnd(500, 'a')),
                occurredAt: at, actualModel: null, usage: { input: '1', output: '0', cacheRead: '0', cacheWrite: '0' } };
              return { before: step, after: step, afterObserved: true };
            }),
          } });
          finalFrames.push(frame({ ...proof, state: 'complete', fingerprint: 'after', steps: proof.baselineSteps })); return finalFrames;
        } };
      } };
  } };
  const cli = createCliAgentDriver(adapter, (binary) => binary);
  const launcher = createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: 10001, which: () => null }), processEnv: {}, workerHome: root, logger: noopLogger });
  const beforeStart = new BeforeStartRunner({ launcher, interpreters: { list: [], extensionFor: () => 'sh', argvFor: () => [] }, emit: () => {}, logger: noopLogger, baseDir: join(root, 'agents') });
  const factory = businessAgentFactory({ launcher, beforeStart, paths: await createWorkdirPaths(root), logger: noopLogger, drivers: { forProtocol: () => ({ protocol: 'opencode', start: (spec, context) => cli.start(spec, { cwd: context.cwd, env: context.env, logger: noopLogger, host }) }) } }, join(root, 'home'));
  const command = StartAgentCommandSchema.parse({ id: 'start', type: 'startAgent', agentId: 'native-agent', processAttemptId: 'native-attempt', compute: 'test', profileRevision: 1,
    launch: { protocol: 'opencode', binaryPath: '/native-test' }, permission: 'full', mode: options.large || options.oneshot ? 'oneshot' : 'interactive', initialPrompt: 'run', resumeSessionId: 'root',
    beforeStart: { profile: '01a0bf5d-8f4b-7001-8458-107366e7de39', revision: 1, contentHash: 'hash', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false } });
  const original = journal.agent.bind(journal);
  journal.agent = (id, event) => { if (options.rejectPending && event.usageCapture?.nativeProof?.state === 'pending') throw new Error('journal unavailable'); return original(id, event); };
  return { root, limits, journal, supervisor, launched, began, prepared, seenAtSpawn, finalFrames, readProofs, isDisposed: () => disposed,
    create: () => factory(command, 1, { nativeUsageTreeV1: 1, nativeUsageLineageKey: 'stable-session' }) };
}

test('first and resumed native turn wait for journal commit across the pending-run and managed queues', async () => {
  const f = await fixture(), agent = await f.create(); await f.began.promise;
  // The CLI must still be absent while the Supervisor has not consumed the pending proof.
  expect(f.seenAtSpawn).toEqual([]);
  f.supervisor.start(identity, async () => agent); await f.launched.promise;
  expect(f.seenAtSpawn).toEqual([['pending']]);
  await agent.send('second turn');
  expect(f.seenAtSpawn[1]).toEqual(['pending', 'complete', 'pending']);
  await agent.cancel();
  expect((await f.supervisor.settled(identity.executionId)).result?.reason).toBe('cancelled');
  const reopened = new ExecutionJournal(join(f.root, 'journal'), 'reader', f.limits); disposals.push(() => reopened.close());
  expect(reopened.replay(identity.executionId, 0).filter(({ frame }) => frame.type === 'agent' && frame.event.usageCapture?.nativeProof?.state === 'pending')).toHaveLength(2);
});

test('a pending journal write failure cancels before any native process is spawned', async () => {
  const f = await fixture({ rejectPending: true }); f.supervisor.start(identity, f.create);
  expect(await f.supervisor.settled(identity.executionId)).toMatchObject({ phase: 'finished', result: { reason: 'event_persistence_failed' } });
  expect(f.seenAtSpawn).toEqual([]);
});

test('more than four MiB of native baseline evidence survives a paused outer consumer and business completion', async () => {
  const f = await fixture({ large: true }), blocked = deferred(), release = deferred();
  let baselineFrames = 0;
  f.supervisor.start(identity, async () => {
    const agent = await f.create();
    return { send: (text) => agent.send(text), cancel: () => agent.cancel(), events: { async *[Symbol.asyncIterator]() {
      for await (const event of agent.events) {
        if (event.usageCapture?.nativeBaseline) { if (++baselineFrames === 1) { blocked.resolve(); await release.promise; } }
        yield event;
      }
    } } };
  });
  await blocked.promise;
  expect(Buffer.byteLength(JSON.stringify(f.finalFrames))).toBeGreaterThan(4 * 1024 * 1024);
  // Allow every runnable producer to reach its capacity; no elapsed-time success assumption.
  await new Promise<void>((resolve) => setImmediate(resolve)); release.resolve();
  expect(await f.supervisor.settled(identity.executionId)).toMatchObject({ phase: 'finished', result: { reason: 'exited', exitCode: 0 } });
  expect(baselineFrames).toBe(40);
  const frames: AgentEvent[] = []; let cursor = 0;
  for (;;) { const page = f.journal.replay(identity.executionId, cursor, 1000); if (!page.length) break; cursor = page.at(-1)!.sequence; frames.push(...page.flatMap(({ frame }) => frame.type === 'agent' ? [frame.event] : [])); }
  expect(frames.filter((event) => event.usageCapture?.nativeBaseline)).toHaveLength(40);
  expect(frames.find((event) => event.usageCapture?.nativeProof?.state === 'complete')).toBeDefined();
});


test('cancellation while the pending receipt is waiting prevents a native spawn', async () => {
  const f = await fixture(), agent = await f.create(); await f.began.promise;
  f.supervisor.start(identity, async () => agent); f.supervisor.cancel(identity.executionId);
  expect(await f.supervisor.settled(identity.executionId)).toMatchObject({ phase: 'finished', result: { reason: 'cancelled' } });
  expect(f.seenAtSpawn).toEqual([]);
});


// Completion cannot append into a full queue while the final proof is still unprocessed.
test('native final proof is processed before the business stream can complete', async () => {
  const f = await fixture({ oneshot: true }), blocked = deferred(), release = deferred();
  f.supervisor.start(identity, async () => {
    const agent = await f.create();
    return { send: (text) => agent.send(text), cancel: () => agent.cancel(), events: { async *[Symbol.asyncIterator]() {
      for await (const event of agent.events) {
        if (event.usageCapture?.nativeProof?.state === 'complete') { blocked.resolve(); await release.promise; }
        yield event;
      }
    } } };
  });
  await blocked.promise;
  const prematureCompletion = f.isDisposed(); release.resolve();
  expect(await f.supervisor.settled(identity.executionId)).toMatchObject({ phase: 'finished', result: { reason: 'exited', exitCode: 0 } });
  expect(prematureCompletion).toBe(false); expect(f.isDisposed()).toBe(true);
});
