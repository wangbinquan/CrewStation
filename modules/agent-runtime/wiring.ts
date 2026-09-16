import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { secretboxCipher } from './adapters/crypto/secretboxCipher';
import { drizzleUnitOfWork } from './adapters/persistence/drizzleUnitOfWork';
import type { AgentRuntimeModuleApi } from './api/moduleApi';
import { activationUseCases } from './application/activation';
import { checkUseCases } from './application/checks';
import type { AgentRuntimeUseCaseDeps } from './application/dependencies';
import { manageConfigUseCases } from './application/manageConfigs';
import { resolveRuntimeUseCases } from './application/resolveRuntime';
import { saveDraftUseCase } from './application/saveDraft';
import { agentRuntimeAdminRoutes } from './http/adminRoutes';
import type { CheckExecutor } from './ports/checkExecutor';
import type { ProfileReferences } from './ports/profileReferences';
import type { SecretCipher } from './ports/secretCipher';
import { checkWorker } from './workers/checkWorker';

export interface AgentRuntimeModuleDeps {
  db: Database;
  isAdmin: (userId: UserId) => Promise<boolean>;
  /** 平台专属检查任务的执行器（task-runtime 实现，由组合根注入）。 */
  executor: CheckExecutor;
  /** 引用某运行环境的算力档位（project 实现）。 */
  references: ProfileReferences;
  settings: { secretKeyBase64: string };
  cipher?: SecretCipher;
  clock?: Clock;
  logger?: Logger;
}

export interface AgentRuntimeModule {
  readonly api: AgentRuntimeModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  readonly migrations: MigrationSet;
}

export const agentRuntimeMigrations: MigrationSet = {
  module: 'agent_runtime',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createAgentRuntimeModule(deps: AgentRuntimeModuleDeps): AgentRuntimeModule {
  const logger = deps.logger ?? noopLogger;
  const useCaseDeps: AgentRuntimeUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db), cipher: deps.cipher ?? secretboxCipher(deps.settings.secretKeyBase64), executor: deps.executor, references: deps.references,
    clock: deps.clock ?? systemClock, logger,
  };
  const checks = checkUseCases(useCaseDeps);
  const resolve = resolveRuntimeUseCases(useCaseDeps);
  const api: AgentRuntimeModuleApi = {
    name: 'agent-runtime',
    ...manageConfigUseCases(useCaseDeps),
    saveDraft: saveDraftUseCase(useCaseDeps),
    startCheck: checks.startCheck, getCheck: checks.getCheck, runQueuedCheck: checks.runQueuedCheck,
    ...activationUseCases(useCaseDeps),
    resolveActive: resolve.resolveActive, resolveRevision: resolve.resolveRevision,
  };
  return { api, http: [agentRuntimeAdminRoutes(api, deps.isAdmin)], workers: [checkWorker(deps.db, api, logger)], migrations: agentRuntimeMigrations };
}
