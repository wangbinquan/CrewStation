import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { secretboxCipher } from './adapters/crypto/secretboxCipher';
import { drizzleDataResourceRepository, drizzleTaskBindingRepository } from './adapters/persistence/drizzleRepositories';
import type { PostgresProviderSettings } from './adapters/postgres/postgresProvider';
import { postgresJsProvider } from './adapters/postgres/postgresProvider';
import type { DataModuleApi } from './api/moduleApi';
import type { DataUseCaseDeps } from './application/dependencies';
import { revokeBindingsOfReleasedTask } from './application/releasedTask';
import { serviceDataUseCases } from './application/serviceData';
import { taskBindingUseCases } from './application/taskBindings';
import type { UserDirectory } from './ports/userDirectory';
import { dataRoutes } from './http/dataRoutes';
import type { DataSettings, ProjectAuthorizer, ServiceResolver } from './ports/platform';
import type { PostgresProvider } from './ports/providers';

export interface DataModuleDeps {
  /** 申请人／审批人名字来源；缺省时绑定 DTO 只带 ID。 */
  users?: UserDirectory;
  db: Database;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: DataSettings & { secretKeyBase64: string; postgres: PostgresProviderSettings };
  provider?: PostgresProvider;
  clock?: Clock;
  logger?: Logger;
  /** 收到期绑定的间隔，缺省 BINDING_EXPIRY_INTERVAL_MS；用例里调短。 */
  expiryIntervalMs?: number;
}

/** 到期绑定每分钟收一次。 */
export const BINDING_EXPIRY_INTERVAL_MS = 60_000;

export interface DataModule {
  readonly api: DataModuleApi;
  readonly http: Hono<AppEnv>[];
  /**
   * 收到期绑定：标成已过期、删掉临时角色。2026-09-23 之前 expireBindings 没有接到任何后台任务，
   * 到期的绑定一直显示生效中，临时角色留在库里（数据库按 VALID UNTIL 拒绝它登录）。
   */
  readonly workers: Array<{ start(): void; stop(): Promise<void> }>;
  /** 任务已释放 → 收回它名下还没结束的绑定（2026-09-23 作者裁定：释放已有弹窗确认，直接收回）。 */
  readonly subscriptions: EventConsumer[];
  readonly migrations: MigrationSet;
}

export const dataMigrations: MigrationSet = {
  module: 'data',
  layer: 3,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export function createDataModule(deps: DataModuleDeps): DataModule {
  const useCaseDeps: DataUseCaseDeps = {
    resources: drizzleDataResourceRepository(deps.db),
    bindings: drizzleTaskBindingRepository(deps.db),
    postgres: deps.provider ?? postgresJsProvider(deps.settings.postgres),
    cipher: secretboxCipher(deps.settings.secretKeyBase64),
    authorizer: deps.authorizer,
    services: deps.services,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? noopLogger,
    ...(deps.users ? { users: deps.users } : {}),
  };
  const service = serviceDataUseCases(useCaseDeps);
  const bindings = taskBindingUseCases(useCaseDeps);
  const api: DataModuleApi = { name: 'data', ensureServiceData: service.ensureServiceData, envFor: service.envFor, listResources: service.listResources, ...bindings };
  let timer: ReturnType<typeof setInterval> | undefined, expiring = false;
  const expireTick = () => {
    if (expiring) return;
    expiring = true;
    void api.expireBindings().catch((error: unknown) => useCaseDeps.logger.error('data binding expiry failed', { error: String(error) })).finally(() => { expiring = false; });
  };
  const expiry = {
    start: () => { timer ??= setInterval(expireTick, deps.expiryIntervalMs ?? BINDING_EXPIRY_INTERVAL_MS); },
    stop: async () => { if (timer) clearInterval(timer); timer = undefined; },
  };
  const revokeReleased = revokeBindingsOfReleasedTask(useCaseDeps);
  const consumer = createEventConsumer({ db: deps.db, consumer: 'data', ...(deps.logger ? { logger: deps.logger } : {}) })
    .on(DomainTopic.taskReleased, async (event) => { await revokeReleased(event.payload.taskId); });
  return { api, http: [dataRoutes(api, deps.isAdmin)], workers: [expiry], subscriptions: [consumer], migrations: dataMigrations };
}
