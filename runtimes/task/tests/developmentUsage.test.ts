// RFC-034: real Runner command handling with a fake model process; no cluster or provider calls.
import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectIdSchema, TaskIdSchema, StartAgentCommandSchema, StartBusinessAgentCommandSchema, RunnerResultPayloads, type DevelopmentUsageAdmission, type RunnerUsageCapture } from '@crewstation/contracts';
import type { AgentDriverFactory } from '../src/agents/driver';
import { createAgentEventFactory } from '../src/agents/driver';
import { createEventQueue } from '../src/agents/eventQueue';
import { DevelopmentUsageJournal } from '../src/agents/developmentUsageJournal';
import { developmentIntentDigest } from '../src/agents/developmentStartIntent';
import { startFakeSession, type FakeSession } from './fakeSession';
import { material, launchSpec } from './profileFixtures';
import { startTestRunner, TEST_TASK_ID, type TestRunner } from './testRunner';

const project = ProjectIdSchema.parse('019f0000-0000-7000-8000-000000000001'), workspace = TaskIdSchema.parse('019f0000-0000-7000-8000-000000000002');
const agentId = '019f0000-0000-7000-8000-000000000004';
const capture: RunnerUsageCapture = { version: 1, measurements: [], diagnostics: ['not-measured'] };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { resolve, promise }; };

async function boot(options: { numeric?: boolean; hold?: boolean; breakStream?: boolean } = {}) {
  const path = await mkdtemp(join(tmpdir(), 'cs-development-runner-')); cleanups.push(() => rm(path, { recursive: true, force: true }));
  const journal = new DevelopmentUsageJournal(path, { projectId: project, workspaceTaskId: workspace, runtimeTaskId: TEST_TASK_ID, podUid: 'pod-a' }, crypto.randomUUID());
  const session: FakeSession = startFakeSession(); cleanups.push(() => session.stop());
  const cancelled = deferred(), release = deferred(); let spawns = 0, home = '';
  const drivers: AgentDriverFactory = { forProtocol: (protocol) => ({ protocol, start: (spec, context) => {
    spawns++; home = context.env.HOME ?? '';  const event = createAgentEventFactory(spec.agentId), events = createEventQueue<ReturnType<typeof event>>();
    events.push(event('started')); context.usageSink?.(capture, new Date().toISOString()); events.push(event('text', { text: 'ordinary-output' }));
    if (options.breakStream) events.fail(new Error('unexpected driver stream failure'));
    else if (!options.hold) { events.push(event('completed')); events.close(); }
    return { events, send: async () => {}, cancel: async () => { cancelled.resolve(); void release.promise.then(() => { context.usageSink?.(capture, new Date().toISOString()); events.push(event('cancelled')); events.close(); }); } };
  } }) };
  if (!options.numeric) cleanups.push(() => journal.close());
  const tr: TestRunner = await startTestRunner(session.url, {}, { drivers, ...(options.numeric ? { developmentUsageJournal: journal } : {}) }); cleanups.push(() => tr.dispose());
  await tr.runner.whenConnected();
  const command = StartAgentCommandSchema.parse({ id: 'start', type: 'startAgent', agentId, compute: 'Named compute', profileRevision: 3, launch: launchSpec(), permission: 'full', mode: 'oneshot', initialPrompt: 'private-prompt', mcp: [], env: {}, beforeStart: material(), processAttemptId: 'fixed-process-attempt' });
  const intent = { version: 1 as const, identity: { sourceKind: 'development-agent' as const, projectId: project, taskId: workspace, executionId: TEST_TASK_ID, executionGeneration: 1 as const, agentId }, profileId: command.beforeStart.profile, profileRevision: command.profileRevision, launch: command.launch, permission: command.permission, mode: command.mode, initialPrompt: command.initialPrompt ?? null, cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'actual-store-lineage' };
  const base = { intent, digestNonce: 'a'.repeat(64) };
  const admission: DevelopmentUsageAdmission = { ...base, key: { executionId: TEST_TASK_ID, journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest(base) } };
  return { path, session, tr, journal, command, admission, cancelled, release, spawns: () => spawns, home: () => home };
}

test('numeric commands and starts are explicit capabilities; legacy agent commands preserve ordinary events', async () => {
  const f = await boot(); expect(f.session.hellos[0]?.capabilities.developmentUsageV1).toBeUndefined();
  await expect(f.session.call({ id: 'info', type: 'developmentUsageInfo' })).rejects.toMatchObject({ code: 'development_usage_unsupported' });
  await expect(f.session.call({ ...f.command, id: 'unsupported-start', developmentUsage: f.admission })).rejects.toMatchObject({ code: 'development_usage_unsupported' });
  expect(f.spawns()).toBe(0);
  await f.session.call(f.command); await f.session.waitForEvent('agent', (e) => e.event.type === 'completed');
  expect(f.spawns()).toBe(1); expect(f.session.eventsOf('agent').map((e) => e.event.event.type)).toEqual(['started', 'text', 'completed']);
});

test('FULL/WAL admission precedes Hook and model; retries keep one process and terminal exposes the persisted numeric tail', async () => {
  const f = await boot({ numeric: true }); expect(f.session.hellos[0]?.capabilities).toMatchObject({ developmentUsageV1: 1, usageObservationsV1: 1 });
  const info = RunnerResultPayloads.developmentUsageInfo.parse(await f.session.call({ id: 'info', type: 'developmentUsageInfo' })); expect(info.receipt).toBeNull();
  const command = { ...f.command, developmentUsage: f.admission };
  await f.session.call(command); await f.session.waitForEvent('agent', (e) => e.event.type === 'completed');
  const end = RunnerResultPayloads.developmentUsageInfo.parse(await f.session.call({ id: 'end', type: 'developmentUsageInfo', key: f.admission.key }));
  expect(end.receipt).toMatchObject({ phase: 'finished', result: 'completed', lastSequence: 1, finalThrough: 1 });
  expect(f.home()).toBe(join(f.tr.config.agentRunDir!, agentId, 'home')); expect(f.spawns()).toBe(1);
  const hooks = f.session.eventsOf('beforeStart').length;
  await f.session.call({ ...command, id: 'retry', env: { REFRESHED_SECRET: 'new-material' } });
  expect(f.spawns()).toBe(1); expect(f.session.eventsOf('beforeStart')).toHaveLength(hooks);
  const page = RunnerResultPayloads.developmentUsageEvents.parse(await f.session.call({ id: 'read', type: 'readDevelopmentUsageEvents', key: f.admission.key, after: 0, limit: 5 }));
  expect(page.events).toHaveLength(1); expect(JSON.stringify(page)).not.toContain('private-prompt');
  expect(RunnerResultPayloads.developmentUsage.parse(await f.session.call({ id: 'ack', type: 'ackDevelopmentUsageEvents', key: f.admission.key, through: page.through })).acknowledgedSequence).toBe(1);
  await expect(f.session.call({ ...command, id: 'changed', initialPrompt: 'changed-prompt' })).rejects.toMatchObject({ code: 'development_intent_conflict' });
  expect(StartBusinessAgentCommandSchema.safeParse({ id: 'business', type: 'startBusinessAgent', executionId: 'business', attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64), digestNonce: 'a'.repeat(64), agent: command }).success).toBe(false);
});

test('shutdown waits for the final numeric pump even when cancel returns before its final capture', async () => {
  const f = await boot({ numeric: true, hold: true }); await f.session.call({ ...f.command, developmentUsage: f.admission });
  await f.session.waitForEvent('agent', (e) => e.event.type === 'started');
  let stopped = false; const stopping = f.tr.runner.stop().then(() => { stopped = true; });
  await f.cancelled.promise; await Promise.resolve(); expect(stopped).toBe(false);
  f.release.resolve(); await stopping;
  const recovered = new DevelopmentUsageJournal(f.path, f.journal.context, crypto.randomUUID());
  try { expect(recovered.info(f.admission.key).receipt).toMatchObject({ phase: 'finished', result: 'cancelled', lastSequence: 2, finalThrough: 2 }); }
  finally { recovered.close(); }
});


test('an unproven event-stream exit retains numeric evidence and reports an interrupted terminal instead of complete zero', async () => {
  const f = await boot({ numeric: true, breakStream: true }); await f.session.call({ ...f.command, developmentUsage: f.admission });
  await f.session.waitForEvent('agent', (e) => e.event.type === 'error');
  expect(f.journal.info(f.admission.key).receipt).toMatchObject({ phase: 'finished', result: 'error', interruption: 'missing-terminal', lastSequence: 1, finalThrough: null });
  expect(f.journal.read(f.admission.key, 0).events).toHaveLength(1); expect(f.spawns()).toBe(1);
});

test('invalid CWD cannot run Hook/model or leave a resumable registered admission', async () => {
  const f = await boot({ numeric: true }), cwd = '../outside-workdir', intent = { ...f.admission.intent, cwd };
  const admission = { ...f.admission, intent, key: { ...f.admission.key, payloadDigest: developmentIntentDigest({ intent, digestNonce: f.admission.digestNonce }) } };
  await expect(f.session.call({ ...f.command, cwd, developmentUsage: admission })).rejects.toThrow();
  expect(f.spawns()).toBe(0); expect(f.session.eventsOf('beforeStart')).toHaveLength(0);
  expect(f.journal.info(admission.key).receipt).toMatchObject({ phase: 'finished', result: 'error', lastSequence: 0 });
  await f.session.call({ ...f.command, id: 'same-invalid-replay', cwd, developmentUsage: admission });
  expect(f.spawns()).toBe(0);
});
