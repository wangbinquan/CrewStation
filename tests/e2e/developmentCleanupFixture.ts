// RFC-034 cross-unit regression: actual SQLite, PG owners, job fence and Controller;
// only Runner/Kubernetes transport is controlled. No deployed identity/model acceptance.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DevelopmentStartIntentSchema, UserIdSchema } from '../../packages/contracts';
import type { DevelopmentUsageAdmission, RunnerCommand, TaskId } from '../../packages/contracts';
import { newResourceId, PlatformError } from '../../packages/kernel';
import { runMigrations } from '../../packages/persistence';
import { DevelopmentUsageJournal } from '../../runtimes/task/src/agents/developmentUsageJournal';
import { developmentCleanupFixture } from '../../modules/task-runtime/tests/developmentCleanupFixture';
import type { DevelopmentCleanupFixture } from '../../modules/task-runtime/tests/developmentCleanupFixture';
import { createSessionModule, sessionMigrations } from '../../modules/session/wiring';
import { drizzleDevelopmentUsageStore } from '../../modules/session/adapters/persistence/developmentUsage';
import { ingestDevelopmentUsage } from '../../modules/session/application/developmentUsageIngestion';
import { developmentAt, developmentCapture } from '../../modules/session/tests/developmentUsageFixtures';
import { createDevSessionModule, devSessionMigrations } from '../../modules/dev-session/wiring';
import { workspaceFixture } from '../../modules/dev-session/tests/workspaceFixture';
import { drizzleAgentStarts } from '../../modules/dev-session/adapters/persistence/drizzleAgentStarts';
import { developmentEndingStore } from '../../modules/dev-session/adapters/persistence/ending/store';
import { developmentCleanupParticipant } from '../../modules/dev-session/application/development/cleanup';
import { developmentCleanupPort } from '../../modules/platform/application/developmentCleanupPorts';
import type { DevelopmentCleanupSession } from '../../modules/dev-session/ports/developmentCleanup';

async function originalOwner(f: DevelopmentCleanupFixture) {
  const clock = f.deps.clock!, controls = { priceRevision: 3, priceCalls: 0 };
  const starts = drizzleAgentStarts(f.tdb.db), n = f.env.native!, profile = f.input.computeProfile!;
  await starts.insert({ agentId: n.agentId!, taskId: f.parent.id, createdBy: UserIdSchema.parse(newResourceId()),
    compute: profile.profileId, profile, permission: 'full', request: { prompt: 'owner-private-prompt', cwd: '/work' },
    execution: { taskId: f.env.id, runnerId: n.runnerId, image: n.image }, state: 'pending', cursor: 0, finalized: false, createdAt: f.env.createdAt.toISOString() });
  const base = workspaceFixture().deps, environments = { ...base.environments, getEnvironment: f.runtime.api.getEnvironment };
  const dev = createDevSessionModule({ ...base, db: f.tdb.db, isAdmin: async () => true, clock, environments,
    developmentUsagePricing: { accept: async (input) => { controls.priceCalls++; return { ...input, acceptedAt: clock.now().toISOString(), priceBookRevision: controls.priceRevision }; } } });
  const owner = dev.api.developmentUsage!;
  const prepared = await owner.prepare({ intent: DevelopmentStartIntentSchema.parse({ version: 1,
    identity: { sourceKind: 'development-agent', projectId: f.env.projectId, taskId: f.parent.id, executionId: f.env.id, executionGeneration: 1, agentId: n.agentId },
    profileId: profile.profileId, profileRevision: profile.revision, permission: 'full', mode: 'interactive', initialPrompt: 'owner-private-prompt', cwd: '/work', resumeSessionId: null,
    systemPrompt: null, mcp: [], launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode' }, nativeUsageLineageKey: 'original-workspace-native-store', nativeSource: { version: 1 } }),
    context: { serviceId: f.parent.serviceId, traceId: f.parent.traceId, branch: f.parent.branch ?? null } });
  return { owner, prepared, starts, clock, environments, controls };
}
function numericCopy(f: DevelopmentCleanupFixture, journal: DevelopmentUsageJournal) {
  const control = { copy: true, autoStop: true, loseStopAck: false, loseDrainAck: false, loseRunnerAck: false, recordsLost: false, loseEndingAck: false };
  const calls: string[] = [];
  const factory = () => createSessionModule({ db: f.tdb.db, runnerAuth: f.runtime.api, taskAccess: f.runtime.api, isAdmin: async () => false,
    settings: { selfAddress: 'http://cleanup.test', commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit: 100 } });
  let session = factory(), store = drizzleDevelopmentUsageStore(f.tdb.db);
  const send = async (_id: TaskId, command: RunnerCommand) => {
    calls.push(command.type);
    if (command.type === 'stopDevelopmentAgent') {
      journal.requestStop(command.admission, command.podUid);
      if (control.autoStop && journal.info(command.admission.key).receipt?.phase !== 'finished') journal.finish(command.admission.key, 'cancelled');
      const result = journal.stopStatus(command.admission.key, false);
      if (control.loseStopAck) { control.loseStopAck = false; throw new Error('stop committed but ACK lost'); }
      return result;
    }
    if (command.type === 'developmentUsageInfo') return journal.info(command.key);
    // Original durable header remains readable while its uncopied numeric pages are explicitly unavailable.
    if (control.recordsLost) throw new PlatformError('precondition', 'original numeric pages unavailable', { code: 'development_journal_lost' });
    if (command.type === 'readDevelopmentUsageEvents') return journal.read(command.key, command.after, command.limit);
    if (command.type === 'ackDevelopmentUsageEvents') {
      if ((await store.get(f.env.id, command.key))!.persistedThrough < command.through) throw new Error('Runner ACK preceded PG commit');
      const receipt = journal.acknowledge(command.key, command.through);
      if (control.loseRunnerAck) { control.loseRunnerAck = false; throw new Error('Runner ACK reply lost'); }
      return receipt;
    }
    throw new Error('unexpected numeric command');
  };
  const port: DevelopmentCleanupSession = {
    registerDevelopmentUsage: (r) => session.api.registerDevelopmentUsage(r),
    getDevelopmentUsage: (id, key) => session.api.getDevelopmentUsage(id, key), sendCommand: send,
    requestDevelopmentUsageDrain: async (id, key, reason) => {
      await session.api.requestDevelopmentUsageDrain(id, key, reason);
      if (control.copy) for (let page = 0; page < 3; page++) {
        const current = (await session.api.getDevelopmentUsage(id, key))!;
        await ingestDevelopmentUsage({ store, send }, current);
        const copied = (await session.api.getDevelopmentUsage(id, key))!;
        if (copied.closure || copied.persistedThrough === current.persistedThrough) break;
      }
      const result = (await session.api.getDevelopmentUsage(id, key))!;
      if (control.loseDrainAck) { control.loseDrainAck = false; throw new Error('drain committed but ACK lost'); }
      return result;
    },
  };
  return { control, calls, port, send, get session() { return session; }, get store() { return store; },
    restart: () => { session = factory(); store = drizzleDevelopmentUsageStore(f.tdb.db); } };
}
export async function developmentCleanupChain(mode: 'ledger' | 'native' = 'ledger', count = 3, receiptProtection = false, historicalUnmarked = false) {
  const f = await developmentCleanupFixture(mode, false, receiptProtection, historicalUnmarked);
  await runMigrations(f.tdb.db, [devSessionMigrations, sessionMigrations]);
  const original = await originalOwner(f), directory = await mkdtemp(join(tmpdir(), 'cs-development-cleanup-'));
  const journal = new DevelopmentUsageJournal(directory, { projectId: f.env.projectId, workspaceTaskId: f.parent.id, runtimeTaskId: f.env.id, podUid: f.env.native!.podUid! }, crypto.randomUUID());
  const bound = await original.owner.bind(f.env.id, journal.info()), registration = bound.binding!;
  const admission: DevelopmentUsageAdmission = { intent: bound.intent, digestNonce: bound.digestNonce, key: registration.key };
  journal.reserve(admission); if (!journal.permitLaunch(registration.key)) throw new Error('original controlled launch was denied'); journal.running(registration.key);
  for (let index = 1; index <= count; index++) journal.capture(registration.key, developmentCapture(index), developmentAt);
  const copy = numericCopy(f, journal), store = developmentEndingStore(f.tdb.db, original.clock), commit = store.commit;
  store.commit = async (...args) => { const result = await commit(...args); if (copy.control.loseEndingAck) { copy.control.loseEndingAck = false; throw new Error('ending committed but ACK lost'); } return result; };
  const participant = developmentCleanupParticipant({ ...original, session: copy.port, store });
  f.replace({ developmentCleanup: developmentCleanupPort(f.runtime.api, participant) });
  await f.runtime.api.releaseEnvironment(f.env.id, 'user');
  let journalClosed = false;
  const closeJournal = () => { if (!journalClosed) { journalClosed = true; journal.close(); } };
  const finalize = async () => {
    const removed = f.wait('finalizer-removed'), controller = f.controller();
    controller.observer.start(); await f.runNative(); await removed; await controller.reconciled(); await controller.observer.stop();
    await f.runNative(); await f.settle();
  };
  return { ...f, get runtime() { return f.runtime; }, ...original, journal, registration, admission, copy, store, participant, closeJournal, finalize,
    close: async () => { closeJournal(); await rm(directory, { recursive: true, force: true }); await f.close(); } };
}
export type DevelopmentCleanupChain = Awaited<ReturnType<typeof developmentCleanupChain>>;
