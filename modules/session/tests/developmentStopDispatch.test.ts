import { afterEach, describe, expect, test } from 'bun:test';
import { RunnerCommandSchema, StartAgentCommandSchema, TASKRUNNER_PROTOCOL_VERSION, type RunnerCommand, type RunnerHello } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { sessionMigrations } from '../wiring';
import { drizzleDevelopmentUsageStore } from '../adapters/persistence/developmentUsage';
import { commandDispatch } from '../application/commandDispatch';
import { persistDevelopmentReply } from '../application/developmentCommandReceipt';
import { RunnerConnection } from '../domain/runnerConnection';
import { terminalViewCommand } from '../domain/terminalViews';
import { developmentReceipt, developmentRegistration } from './developmentUsageFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original-key numeric stop dispatch with real PG', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  const setup = async () => {
    tdb = await createTestDatabase([sessionMigrations]); const store = drizzleDevelopmentUsageStore(tdb.db), r = developmentRegistration(), sent: RunnerCommand[] = [];
    const intent = { version: 1, identity: r.identity, profileId: r.profileId, profileRevision: r.profileRevision, launch: { protocol: 'opencode', binaryPath: '/fixture/opencode', extraArgs: [], isSandbox: false }, permission: 'edit', mode: 'interactive', initialPrompt: 'fixture', cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'expected-source' };
    const start = StartAgentCommandSchema.parse({ id: 'start', type: 'startAgent', agentId: r.identity.agentId, compute: 'fixture', profileRevision: r.profileRevision, launch: intent.launch, permission: intent.permission, mode: intent.mode, initialPrompt: intent.initialPrompt,
      beforeStart: { profile: r.profileId, revision: r.profileRevision, contentHash: 'fixture', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false }, processAttemptId: 'fixture', developmentUsage: { intent, key: r.key, digestNonce: 'a'.repeat(64) } });
    const stop = RunnerCommandSchema.parse({ id: 'stop', type: 'stopDevelopmentAgent', admission: start.developmentUsage, podUid: r.podUid });
    const capabilities: RunnerHello['capabilities'] = { protocols: ['opencode'], pty: false, preview: false, developmentUsageV1: 1, developmentUsageStopV1: 1, usageObservationsV1: 1 };
    const payload = { version: 1, state: 'unknown', receipt: developmentReceipt(r, 0, { phase: 'finished', result: 'error', interruption: 'missing-terminal' }) };
    const connection = new RunnerConnection({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: r.runtimeTaskId, runnerToken: 'fixture', workdir: '/work', capabilities }, { send: (raw) => {
      const command = RunnerCommandSchema.parse(JSON.parse(raw)); sent.push(command);
      queueMicrotask(() => connection.pending.settle(command.id, { ok: true, payload }));
    } }, 0, 1000, 0);
    const dispatch = commandDispatch({ developmentUsage: store, registry: { lookup: async () => undefined, claim: async () => {}, release: async () => {}, heartbeat: async () => {} },
      forwarder: { forward: async () => { throw new Error('no forwarding fixture'); } }, clock: fixedClock('2026-09-30T08:00:00Z'), settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60000, replayLimit: 100 } }, { connections: new Map([[r.runtimeTaskId, connection]]) });
    return { store, r, start, stop, sent, capabilities, dispatch, payload };
  };
  test('drain forbids new Start but permits original Stop and commits the unknown receipt before returning', async () => {
    const h = await setup(); await h.store.register(h.r); await h.store.requestDrain(h.r.runtimeTaskId, h.r.key, 'cancelled');
    await expect(h.dispatch.sendCommand(h.r.runtimeTaskId, h.start)).rejects.toThrow('不能重新启动'); expect(h.sent).toHaveLength(0);
    expect(await h.dispatch.sendCommand(h.r.runtimeTaskId, h.stop)).toEqual(h.payload);
    expect(await h.store.get(h.r.runtimeTaskId, h.r.key)).toMatchObject({ persistedThrough: 0, receipt: { phase: 'finished', result: 'error', interruption: 'missing-terminal' }, complete: false, closure: { status: 'interrupted' } });
    expect(() => terminalViewCommand(h.stop, 'untrusted-view')).toThrow('持久采集');
  });
  test('missing capability, missing registration and wrong Pod are rejected before a socket write', async () => {
    const h = await setup();
    await expect(h.dispatch.sendCommand(h.r.runtimeTaskId, h.stop)).rejects.toThrow('持久登记');
    await h.store.register(h.r); delete h.capabilities.developmentUsageStopV1;
    await expect(h.dispatch.sendCommand(h.r.runtimeTaskId, h.stop)).rejects.toThrow('持久停止能力'); expect(h.sent).toHaveLength(0);
    h.capabilities.developmentUsageStopV1 = 1;
    if (h.stop.type !== 'stopDevelopmentAgent') throw new Error('fixture stop');
    await expect(h.dispatch.sendCommand(h.r.runtimeTaskId, { ...h.stop, podUid: 'replacement' })).rejects.toThrow('原Pod'); expect(h.sent).toHaveLength(0);
  });
  test('mismatched stop reply or a failed PG commit cannot promise completion', async () => {
    const h = await setup(); await h.store.register(h.r);
    await expect(persistDevelopmentReply(h.store, h.r.runtimeTaskId, h.stop, { ...h.payload, receipt: { ...h.payload.receipt, podUid: 'replacement' } })).rejects.toThrow('原键和Pod');
    const fail = { ...h.store, ingest: async () => { throw new Error('actual persistence failed'); } };
    await expect(persistDevelopmentReply(fail, h.r.runtimeTaskId, h.stop, h.payload)).rejects.toThrow('actual persistence failed');
    expect((await h.store.get(h.r.runtimeTaskId, h.r.key))?.receipt).toBeNull();
  });
});
