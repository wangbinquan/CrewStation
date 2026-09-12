import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { yamlManifestParser } from './adapters/manifest/yamlManifestParser';
import { drizzleReminderRepository } from './adapters/persistence/drizzleReminderRepository';
import type { DevSessionModuleApi } from './api/moduleApi';
import { agentUseCases } from './application/agents';
import type { DevSessionUseCaseDeps } from './application/dependencies';
import { idleReminderUseCase } from './application/idleReminder';
import { publishFromSessionUseCase } from './application/publishFromSession';
import { sessionLifecycleUseCases } from './application/sessionLifecycle';
import { devSessionRoutes } from './http/devSessionRoutes';
import type { ComputeCatalog, DevSessionSettings, McpCredentials, Notifier, ProjectAuthorizer, Releases, ServiceResolver, SourceControl } from './ports/platform';
import type { Environments, Runner } from './ports/runtime';

export interface DevSessionModuleDeps {
  /** 算力档位解析（RFC-001），由组合根接到 project。 */
  compute: ComputeCatalog;
  db: Database;
  environments: Environments;
  runner: Runner;
  scm: SourceControl;
  releases: Releases;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  notifier: Notifier;
  credentials: McpCredentials;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: DevSessionSettings;
  clock?: Clock;
  logger?: Logger;
}

export interface DevSessionModule {
  readonly api: DevSessionModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly migrations: MigrationSet;
}

export const devSessionMigrations: MigrationSet = {
  module: 'dev_session',
  layer: 5,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createDevSessionModule(deps: DevSessionModuleDeps): DevSessionModule {
  const useCaseDeps: DevSessionUseCaseDeps = {
    environments: deps.environments, runner: deps.runner, scm: deps.scm, releases: deps.releases, manifests: yamlManifestParser,
    authorizer: deps.authorizer,
    compute: deps.compute, services: deps.services, notifier: deps.notifier, credentials: deps.credentials, reminders: drizzleReminderRepository(deps.db),
    settings: deps.settings, clock: deps.clock ?? systemClock, logger: deps.logger ?? noopLogger,
  };
  const lifecycle = sessionLifecycleUseCases(useCaseDeps);
  const agents = agentUseCases(useCaseDeps);
  const remind = idleReminderUseCase(useCaseDeps);
  const api: DevSessionModuleApi = { name: 'dev-session', ...lifecycle, ...agents, publish: publishFromSessionUseCase(useCaseDeps), sendIdleReminders: remind };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    api,
    http: [devSessionRoutes(api, deps.isAdmin)],
    workers: [{ start: () => { timer ??= setInterval(() => void remind().catch((e: unknown) => useCaseDeps.logger.error('idle reminder failed', { error: String(e) })), 60_000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; } }],
    migrations: devSessionMigrations,
  };
}
