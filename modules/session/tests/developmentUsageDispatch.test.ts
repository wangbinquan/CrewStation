// RFC-034: original PG binding before socket writes and the owner-only HTTP/API/client surface.
import { afterEach, describe, expect, test } from 'bun:test';
import type { RunnerCommand, RunnerHello } from '@crewstation/contracts';
import { StartAgentCommandSchema, TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { fixedClock } from '@crewstation/kernel';
import { createSessionClient } from '../../../packages/session-client';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { drizzleDevelopmentUsageStore } from '../adapters/persistence/developmentUsage';
import { commandDispatch } from '../application/commandDispatch';
import { prepareDevelopmentCommand, persistDevelopmentReply } from '../application/developmentCommandReceipt';
import { RunnerConnection } from '../domain/runnerConnection';
import { developmentUsageRoutes } from '../http/developmentUsageRoutes';
import { createSessionModule, sessionMigrations } from '../wiring';
import { developmentCapture, developmentPage, developmentReceipt, developmentRegistration } from './developmentUsageFixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development Session PG admission guards and owner interfaces', () => {
  let tdb: TestDatabase;
  afterEach(async () => { await tdb?.drop(); });
  const setup = async () => { tdb = await createTestDatabase([sessionMigrations]); return { r: developmentRegistration(), store: drizzleDevelopmentUsageStore(tdb.db) }; };

  test('original binding and copied ACK precede socket writes; ordinary old starts remain compatible', async () => {
    const { r, store } = await setup(), sent: RunnerCommand[] = [];
    const intent = { version: 1, identity: r.identity, profileId: r.profileId, profileRevision: r.profileRevision, launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'edit', mode: 'oneshot', initialPrompt: 'owner-private', cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'native-lineage' };
    const command = StartAgentCommandSchema.parse({ id: 'numeric-start', type: 'startAgent', agentId: r.identity.agentId, compute: 'named-compute', profileRevision: r.profileRevision, launch: intent.launch, permission: intent.permission, mode: intent.mode, initialPrompt: intent.initialPrompt,
      mcp: [], env: {}, beforeStart: { profile: r.profileId, revision: r.profileRevision, contentHash: 'fixed', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false }, processAttemptId: 'attempt-1', developmentUsage: { intent, key: r.key, digestNonce: 'a'.repeat(64) } });
    const capabilities: RunnerHello['capabilities'] = { protocols: ['opencode'], pty: false, preview: false, developmentUsageV1: 1, usageObservationsV1: 1 };
    const connection = new RunnerConnection({ type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: r.runtimeTaskId, runnerToken: 'test', workdir: '/work', capabilities }, { send: (raw) => {
      const wire = JSON.parse(raw) as RunnerCommand; sent.push(wire);
      void store.get(r.runtimeTaskId, r.key).then((saved) => {
        if (wire.type === 'startAgent' && wire.developmentUsage) expect(saved?.registration).toEqual(r);
        const payload = wire.type === 'ackDevelopmentUsageEvents' ? developmentReceipt(r, 1, { acknowledgedSequence: wire.through }) : wire.type === 'developmentUsageInfo' ? { version: 1, runtimeTaskId: r.runtimeTaskId, podUid: r.podUid, journalId: r.key.journalId, incarnation: r.key.incarnation, receipt: developmentReceipt(r, 1) } : { agentId: r.identity.agentId };
        connection.pending.settle(wire.id, { ok: true, payload });
      });
    } }, 0, 1000, 0);
    const dispatch = commandDispatch({ developmentUsage: store, registry: { lookup: async () => undefined, claim: async () => {}, release: async () => {}, heartbeat: async () => {} }, forwarder: { forward: async () => { throw new Error('unexpected forward'); } },
      clock: fixedClock('2026-09-30T06:00:00Z'), settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60000, replayLimit: 100 } }, { connections: new Map([[r.runtimeTaskId, connection]]) });
    await expect(dispatch.sendCommand(r.runtimeTaskId, command)).rejects.toThrow('持久登记'); expect(sent).toHaveLength(0);
    await store.register(r); await dispatch.sendCommand(r.runtimeTaskId, command); expect(sent).toHaveLength(1);
    await expect(prepareDevelopmentCommand(undefined, r.runtimeTaskId, command)).rejects.toThrow('未启用');
    await expect(dispatch.sendCommand(r.runtimeTaskId, { id: 'early-ack', type: 'ackDevelopmentUsageEvents', key: r.key, through: 1 })).rejects.toThrow('尚未复制'); expect(sent).toHaveLength(1);
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 1), developmentPage(r, 0, 1));
    await dispatch.sendCommand(r.runtimeTaskId, { id: 'copied-ack', type: 'ackDevelopmentUsageEvents', key: r.key, through: 1 }); expect((await store.get(r.runtimeTaskId, r.key))?.runnerAcknowledgedThrough).toBe(1);
    await dispatch.sendCommand(r.runtimeTaskId, { id: 'info', type: 'developmentUsageInfo', key: r.key });
    await expect(dispatch.sendCommand(r.runtimeTaskId, { ...command, id: 'wrong-owner', developmentUsage: { ...command.developmentUsage!, intent: { ...command.developmentUsage!.intent, profileRevision: 4 } } })).rejects.toThrow('归属不同');
    const before = sent.length; await store.unavailable(r.runtimeTaskId, { key: r.key, podUid: r.podUid, reason: 'journal-replaced' });
    await expect(dispatch.sendCommand(r.runtimeTaskId, { ...command, id: 'rebind' })).rejects.toThrow('不能重新启动'); expect(sent).toHaveLength(before);
    const { developmentUsage: _numeric, ...ordinary } = command; await dispatch.sendCommand(r.runtimeTaskId, { ...ordinary, id: 'ordinary' }); expect(sent).toHaveLength(before + 1);
    await persistDevelopmentReply(undefined, r.runtimeTaskId, command, {});
    await expect(persistDevelopmentReply(store, r.runtimeTaskId, { id: 'bad-confirm', type: 'ackDevelopmentUsageEvents', key: r.key, through: 1 }, developmentReceipt(r, 1))).rejects.toThrow('未确认');
  });

  test('late pre-admission null info cannot invalidate a subsequently committed acceptance', async () => {
    const { r, store } = await setup(); await store.register(r);
    const command: RunnerCommand = { id: 'pre-admission-info', type: 'developmentUsageInfo', key: r.key };
    const delayed = { version: 1, runtimeTaskId: r.runtimeTaskId, podUid: r.podUid, journalId: r.key.journalId, incarnation: r.key.incarnation, receipt: null };
    expect((await store.get(r.runtimeTaskId, r.key))?.receipt).toBeNull();
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 1), developmentPage(r, 0, 1));
    await persistDevelopmentReply(store, r.runtimeTaskId, command, delayed);
    expect(await store.get(r.runtimeTaskId, r.key)).toMatchObject({ receipt: { lastSequence: 1 }, persistedThrough: 1, loss: null, closure: null });
    expect(await store.pending([r.runtimeTaskId], 20)).toHaveLength(1);
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 2), developmentPage(r, 1, 1));
    expect((await store.get(r.runtimeTaskId, r.key))?.persistedThrough).toBe(2);
  });

  test('offline owner endpoints, public API and strict client retain original source and durable evidence', async () => {
    const { r, store } = await setup();
    const module = createSessionModule({ db: tdb.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'offline' }) }, taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
      settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60000, replayLimit: 100 } });
    const app = createApp({ name: 'development-owner-test' }); app.route('/', module.http.internal);
    const client = createSessionClient('http://session', Object.assign(async (url: string | URL | Request, init?: RequestInit) => app.request(new Request(url, init)), { preconnect: fetch.preconnect }));
    expect(await client.registerDevelopmentUsage(r)).toMatchObject({ receipt: null, registration: r });
    expect(await module.api.registerDevelopmentUsage(r)).toEqual(await client.getDevelopmentUsage(r.runtimeTaskId, r.key));
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 1, { phase: 'finished', result: 'completed', finalThrough: 1 }), developmentPage(r, 0, 1));
    const page = await module.api.nextDevelopmentUsageSource(); expect(page).toEqual(developmentPage(r, 0, 1));
    expect(await module.api.readDevelopmentUsageMeasurement(r.key, 'step-1', 1)).toEqual(developmentCapture(1).measurements[0]);
    await module.api.acknowledgeDevelopmentUsageSource(r.key, 1); expect(await module.api.nextDevelopmentUsageSource()).toBeUndefined();
    expect(await client.requestDevelopmentUsageDrain(r.runtimeTaskId, r.key, 'completed')).toMatchObject({ closure: { status: 'complete', persistedThrough: 1 } });
    const loss = { key: r.key, podUid: r.podUid, reason: 'forced-release' as const };
    await client.markDevelopmentUsageUnavailable(r.runtimeTaskId, loss); await module.api.markDevelopmentUsageUnavailable(r.runtimeTaskId, loss);
    expect(await module.api.requestDevelopmentUsageDrain(r.runtimeTaskId, r.key, 'completed')).toEqual(await client.getDevelopmentUsage(r.runtimeTaskId, r.key));
    expect(await module.api.getDevelopmentUsage(r.runtimeTaskId, r.key)).toMatchObject({ complete: true });
    await expect(client.getDevelopmentUsage(developmentRegistration().runtimeTaskId, r.key)).rejects.toMatchObject({ kind: 'not_found' });
    const bad = await app.request('/internal/development-usage/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...r, prompt: 'must-not-store' }) }); expect(bad.status).toBe(400);
    const disabled = createApp({ name: 'disabled-development-store' }); disabled.route('/', developmentUsageRoutes({}));
    expect((await disabled.request('/internal/development-usage/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) })).status).toBe(412);
    for (const worker of module.workers) await worker.stop();
  });
});
