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
import { httpImageRegistry } from './adapters/registry/httpImageRegistry';
import type { AgentRuntimeModuleApi } from './api/moduleApi';
import type { AgentRuntimeUseCaseDeps } from './application/dependencies';
import { profileQueries } from './application/profileQueries';
import { profileSettingUseCases } from './application/profileSettings';
import { profileTestUseCases } from './application/profileTests';
import { profileWriteUseCases } from './application/profileWrites';
import { resolveProfileUseCases } from './application/resolveProfile';
import { runtimeImageUseCases } from './application/runtimeImages';
import type { RegistryLayout } from './domain/imageReference';
import { computeProfileAdminRoutes, computeProfileCatalogRoutes, registryForwardAuthRoutes } from './http/adminRoutes';
import type { ImageRegistry } from './ports/imageRegistry';
import type { ProfileReferences } from './ports/profileReferences';
import type { SecretCipher } from './ports/secretCipher';
import type { TaskProfileDirectory } from './ports/taskProfiles';
import type { ProfileTestExecutor } from './ports/testExecutor';
import { testWorker } from './workers/testWorker';

export interface AgentRuntimeModuleDeps {
  db: Database;
  isAdmin: (userId: UserId) => Promise<boolean>;
  /** 平台命名空间里的档位测试执行器（task-runtime 实现，由组合根注入，ADR-0005）。 */
  executor: ProfileTestExecutor;
  /** 已上线版本对档位的按名引用（release 实现，由组合根注入）。 */
  references: ProfileReferences;
  /** 资源套餐目录（project 实现，由组合根注入）。 */
  taskProfiles: TaskProfileDirectory;
  /** registry.baseTag：平台底座镜像的标签；pushCredentialTtlSeconds：推送凭据有效期，默认 8 小时。 */
  settings: { secretKeyBase64: string; registry: RegistryLayout & { scheme: 'http' | 'https'; baseTag: string }; pushCredentialTtlSeconds?: number };
  registry?: ImageRegistry;
  cipher?: SecretCipher;
  clock?: Clock;
  logger?: Logger;
}

export interface AgentRuntimeModule {
  readonly api: AgentRuntimeModuleApi;
  readonly http: Hono<AppEnv>[];
  /** 挂在 cs-auth 的网关鉴权端点（平台镜像仓库主机）。 */
  readonly forwardAuth: Hono<AppEnv>[];
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
  const { scheme, baseTag, ...layout } = deps.settings.registry;
  const useCaseDeps: AgentRuntimeUseCaseDeps = {
    uow: drizzleUnitOfWork(deps.db), cipher: deps.cipher ?? secretboxCipher(deps.settings.secretKeyBase64), executor: deps.executor, references: deps.references,
    taskProfiles: deps.taskProfiles, registry: deps.registry ?? httpImageRegistry({ layout, scheme }), clock: deps.clock ?? systemClock, logger,
  };
  const queries = profileQueries(useCaseDeps);
  const tests = profileTestUseCases(useCaseDeps);
  const resolver = resolveProfileUseCases(useCaseDeps);
  // 推送凭据的签名密钥与 secretbox 密钥同源但分用途派生，二者互不可替代。
  const signingKey = new Bun.CryptoHasher('sha256').update('crewstation:registry-push-key:v1').update(Buffer.from(deps.settings.secretKeyBase64, 'base64')).digest();
  const images = runtimeImageUseCases(useCaseDeps, { signingKey, baseTag, ttlSeconds: deps.settings.pushCredentialTtlSeconds ?? 8 * 3600 });
  const api: AgentRuntimeModuleApi = {
    name: 'agent-runtime',
    listProfiles: queries.listProfiles, getProfile: queries.getProfile, listSummaries: queries.listSummaries,
    ...profileWriteUseCases(useCaseDeps),
    ...profileSettingUseCases(useCaseDeps),
    startTest: tests.startTest, getTest: tests.getTest, runQueuedTest: tests.runQueuedTest,
    resolve: resolver.resolve, launchMaterial: resolver.launchMaterial, lookupForRelease: resolver.lookupForRelease, listNames: resolver.listNames,
    runtimeImages: images.runtimeImages, issuePushCredential: images.issuePushCredential, authorizeRegistryRequest: images.authorizeRegistryRequest,
  };
  return { api, http: [computeProfileAdminRoutes(api, deps.isAdmin), computeProfileCatalogRoutes(api)], forwardAuth: [registryForwardAuthRoutes(api)], workers: [testWorker(deps.db, api, logger)], migrations: agentRuntimeMigrations };
}
