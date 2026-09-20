import { legacyRunnerIdentity } from './adapters/persistence/legacyRunnerIdentity';
import type { ResourceIdentityDirectory } from '@crewstation/persistence';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { fetchForwarder } from './adapters/http/fetchForwarder';
import { drizzleConnectionRegistry, drizzleRunnerEventStore } from './adapters/persistence/drizzleRepositories';
import type { SessionModuleApi } from './api/moduleApi';
import { browserStreams } from './application/browserStreams';
import { commandDispatch } from './application/commandDispatch';
import type { SessionUseCaseDeps } from './application/dependencies';
import { runnerHub } from './application/runnerHub';
import { browserSocketRoutes } from './http/browserSocket';
import { internalRoutes } from './http/internalRoutes';
import { runnerSocketRoutes } from './http/runnerSocket';
import type { CommandForwarder, SessionSettings } from './ports/forwarding';
import type { RunnerAuth, TaskAccess } from './ports/taskRuntime';

export interface SessionModuleDeps {
  identities?: ResourceIdentityDirectory;
  db: Database;
  runnerAuth: RunnerAuth;
  taskAccess: TaskAccess;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: SessionSettings;
  forwarder?: CommandForwarder;
  clock?: Clock;
  logger?: Logger;
}

export interface SessionModule {
  readonly api: SessionModuleApi;
  readonly http: { runner: Hono<AppEnv>; stream: Hono<AppEnv>; internal: Hono<AppEnv> };
  /** 交给 Bun.serve 的 websocket 处理器。 */
  readonly websocket: ReturnType<typeof createBunWebSocket<ServerWebSocket>>['websocket'];
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly migrations: MigrationSet;
}

export const sessionMigrations: MigrationSet = {
  module: 'session',
  layer: 5,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createSessionModule(deps: SessionModuleDeps): SessionModule {
  const useCaseDeps: SessionUseCaseDeps = {
    events: drizzleRunnerEventStore(deps.db),
    legacyRunners: deps.identities ? legacyRunnerIdentity(deps.identities) : undefined,
    registry: drizzleConnectionRegistry(deps.db),
    forwarder: deps.forwarder ?? fetchForwarder(),
    runnerAuth: deps.runnerAuth,
    taskAccess: deps.taskAccess,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? noopLogger,
  };
  const hub = runnerHub(useCaseDeps);
  const dispatch = commandDispatch(useCaseDeps, hub);
  const streams = browserStreams(useCaseDeps, hub, dispatch);
  const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();
  const api: SessionModuleApi = {
    name: 'session',
    sendCommand: dispatch.sendCommand,
    connectionStatus: dispatch.connectionStatus,
    listEvents: async (taskId, options) => (await useCaseDeps.events.listSince(taskId, options.sinceSeq ?? 0, { limit: options.limit ?? 500, ...(options.kinds ? { kinds: options.kinds } : {}), ...(options.agentId ? { agentId: options.agentId } : {}) })).map((e) => ({ seq: e.seq, at: e.at.toISOString(), event: e.event })),
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    api,
    http: { runner: runnerSocketRoutes(hub, upgradeWebSocket), stream: browserSocketRoutes(streams, deps.isAdmin, upgradeWebSocket), internal: internalRoutes(dispatch, useCaseDeps) },
    websocket,
    workers: [{ start: () => { timer ??= setInterval(() => void hub.tick(), 5000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: sessionMigrations,
  };
}
