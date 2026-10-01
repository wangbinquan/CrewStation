import { taskStorageStatus } from './application/objects/taskStorageStatus';
import type { ObjectTransferOwners } from './ports/objectTransferOwners';
import { recoverStoppedReads } from './adapters/persistence/objects/readRecovery';
import { restoreObjectOperations } from './application/objects/restore';
import { objectRestoreRepository } from './adapters/persistence/objects/restore';
import type { ObjectRestorePlane } from './ports/objectRestore';
import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import type { EventConsumer } from '@crewstation/eventbus';
import { createEventConsumer } from '@crewstation/eventbus';
import type { AppEnv } from '@crewstation/http';
import type { Clock, Logger } from '@crewstation/kernel';
import { newResourceId, noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { secretboxCipher } from './adapters/crypto/secretboxCipher';
import { drizzleDataResourceRepository, drizzleTaskBindingRepository } from './adapters/persistence/drizzleRepositories';
import type { PostgresProviderSettings } from './adapters/postgres/postgresProvider';
import { postgresDsn, postgresJsProvider } from './adapters/postgres/postgresProvider';
import type { DataModuleApi } from './api/moduleApi';
import type { DataUseCaseDeps } from './application/dependencies';
import { dataLedgerProjection } from './application/ledgerProjection';
import { revokeBindingsOfReleasedTask } from './application/releasedTask';
import { serviceDataUseCases } from './application/serviceData';
import { rotateCredentialUseCase } from './application/rotateCredential';
import { taskBindingUseCases } from './application/taskBindings';
import { productionResourceAccess } from './application/resource-center/productionAccess';
import type { ProductionAccessTasks } from './ports/resource-center/productionTasks';
import type { DataCredentials } from './ports/credentials';
import type { UserDirectory } from './ports/userDirectory';
import { dataRoutes } from './http/dataRoutes';
import type { DataLedger } from './ports/ledger';
import { dataLedgerResyncWorker } from './workers/dataLedgerResync';
import type { DataSettings, ProjectAuthorizer, ServiceResolver } from './ports/platform';
import type { PostgresNativeWork, PostgresProvider } from './ports/providers';
import { objectCatalogRepository } from './adapters/persistence/objectCatalog';
import { objectReadRepository } from './adapters/persistence/objectReads';
import { objectUploadRepository } from './adapters/persistence/objectUploads';
import { objectContentRepository } from './adapters/persistence/objectContent';
import { objectService } from './application/objectService';
import { objectProvisioning } from './application/objectProvisioning';
import { objectServiceRoutes } from './http/objectServiceRoutes';
import type { ObjectSourceResolver } from './ports/objectSources';
import { objectMaintenanceWorkers } from './workers/objectMaintenance';
import { objectRecoveryRepository } from './adapters/persistence/objects/recovery';
import { storageContractRepository } from './adapters/persistence/objects/contract';
import { taskInputRepository } from './adapters/persistence/objects/taskInputs';
import { taskInputUseCases } from './application/objects/taskInputs';
import { taskInputRoutes } from './http/taskInputRoutes';
import { objectAdministration } from './application/objectAdministration';
import { objectLedgerProjection } from './application/objectLedgerProjection';
import { objectAdminRoutes, objectMetricsExporter } from './http/objectAdminRoutes';
import type { ObjectBackendPlane, ObjectStorageHistory } from './ports/objectStorage';
import type { ArchiveTaskDirectory } from './ports/archiveTasks';
import { archivePlanRepository } from './adapters/persistence/archive/plans';
import { archiveService } from './application/archiveService';
import { archiveServiceRoutes } from './http/archiveServiceRoutes';
import { archiveAdministration } from './application/archiveAdministration';
import { archiveLossRepository } from './adapters/persistence/archive/loss';
import { archiveFinalization } from './application/archiveFinalization';
import { archiveBindingRepository } from './adapters/persistence/archive/bindings';
import { archiveHelperRepository } from './adapters/persistence/archive/helperGrants';
import { archiveHelpers } from './application/archiveHelpers';
import { archiveHelperRoutes } from './http/archiveHelperRoutes';
import { objectCredentialRotations } from './adapters/persistence/objectRotation';
import { objectBackupRepository } from './adapters/persistence/objects/backups';
import { objectBackupOperations } from './application/objects/backup';
import type { ObjectBytes } from './ports/objectStorage';
import { fileBackupBundle } from './adapters/filesystem/backupBundle';
import { readBackupBundle } from './adapters/filesystem/backupRead';
import { verifyRestoredObjects } from './application/objects/restoreVerification';
import type { VerifiedBackupBundle } from './ports/objectBackups';

export interface DataModuleDeps {
  productionTasks?: ProductionAccessTasks;
  /** 申请人／审批人名字来源；缺省时绑定 DTO 只带 ID。 */
  users?: UserDirectory;
  db: Database;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  isAdmin: (userId: UserId) => Promise<boolean>;
  settings: DataSettings & { secretKeyBase64: string; postgres: PostgresProviderSettings };
  provider?: PostgresProvider;
  nativePostgres?: PostgresNativeWork;
  clock?: Clock;
  logger?: Logger;
  /** 收到期绑定的间隔，缺省 BINDING_EXPIRY_INTERVAL_MS；用例里调短。 */
  expiryIntervalMs?: number;
  /** 资源台账（RFC-025 第四期）：给了就把数据资源与访问绑定投影成 `database`／`data-binding` 记录，并每 5 分钟补投影。 */
  ledger?: DataLedger;
  /**
   * RFC-025 I28：生产库、开发库由 data-control 建，运行角色的口令经这个端口要（组合根接上 data-control）；要配台账。
   * 不给就照旧由本模块建。provisioningTiming 调短等待（用例）。
   */
  credentials?: DataCredentials;
  provisioningTiming?: { waitMs?: number; pollMs?: number };
  objects?: { inputApiUrl?: string; transferOwners?: ObjectTransferOwners; plane: ObjectBackendPlane; history?: ObjectStorageHistory; exporterToken: string; sources?: ObjectSourceResolver; tasks?: ArchiveTaskDirectory; provisioning?: { deploymentMode: 'local' | 'production'; apiUrl: string } };
}

/** 到期绑定每分钟收一次。 */
export const BINDING_EXPIRY_INTERVAL_MS = 60_000;

export interface DataModule {
  readonly api: DataModuleApi;
  readonly http: Hono<AppEnv>[];
  readonly internalHttp: Hono<AppEnv>[];
  readonly transferHttp: Hono<AppEnv>[];
  /**
   * 收到期绑定：标成已过期、删掉临时角色。2026-09-23 之前 expireBindings 没有接到任何后台任务，
   * 到期的绑定一直显示生效中，临时角色留在库里（数据库按 VALID UNTIL 拒绝它登录）。配了台账时还有每 5 分钟的补投影。
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
  const logger = deps.logger ?? noopLogger;
  const byDataControl = Boolean(deps.ledger && deps.credentials);
  const projection = deps.ledger ? dataLedgerProjection(deps.ledger, logger, byDataControl) : undefined;
  const stored = { resources: drizzleDataResourceRepository(deps.db), bindings: drizzleTaskBindingRepository(deps.db) };
  const useCaseDeps: DataUseCaseDeps = {
    resources: projection ? projection.resources(stored.resources) : stored.resources,
    bindings: projection ? projection.bindings(stored.bindings, stored.resources) : stored.bindings,
    postgres: deps.provider ?? postgresJsProvider(deps.settings.postgres, deps.nativePostgres),
    cipher: secretboxCipher(deps.settings.secretKeyBase64),
    authorizer: deps.authorizer,
    services: deps.services,
    settings: deps.settings,
    clock: deps.clock ?? systemClock,
    logger,
    ...(deps.productionTasks ? { productionTasks: deps.productionTasks } : {}),
    ...(deps.users ? { users: deps.users } : {}),
    ...(deps.ledger && deps.credentials ? { provisioning: { credentials: deps.credentials, ledger: deps.ledger, dsnOf: (role: string, password: string, database: string) => postgresDsn(deps.settings.postgres, role, password, database), ...deps.provisioningTiming } } : {}),
  };
  const service = serviceDataUseCases(useCaseDeps);
  const bindings = { ...taskBindingUseCases(useCaseDeps), ...productionResourceAccess(useCaseDeps, deps.productionTasks, deps.isAdmin) };
  const storedObjects = objectCatalogRepository(deps.db, { requireContract: true }), objectProjection = deps.ledger ? objectLedgerProjection(storedObjects, deps.ledger, deps.clock ?? systemClock, logger) : undefined;
  const objectCatalog = objectProjection?.catalog ?? storedObjects, objectUploads = objectUploadRepository(deps.db);
  const objectOwner = `${deps.objects?.transferOwners?.podUid ? deps.objects.transferOwners.podUid + ':' : ''}${newResourceId()}`, objectContent = objectContentRepository(deps.db);
  const inputs = deps.objects?.provisioning ? taskInputUseCases({ inputs: taskInputRepository(deps.db), content: objectContent, plane: deps.objects.plane, owner: objectOwner, apiUrl: deps.objects.inputApiUrl ?? deps.objects.provisioning.apiUrl, secretKeyBase64: deps.settings.secretKeyBase64 }) : undefined;
  const objects = deps.objects ? objectAdministration({ catalog: objectCatalog, reads: objectReadRepository(deps.db), plane: deps.objects.plane, authorizer: deps.authorizer, backups: objectBackupRepository(deps.db), rotations: objectCredentialRotations(deps.db), services: deps.services, downloads: { content: objectContent, owner: objectOwner }, ...(deps.objects.history ? { history: deps.objects.history } : {}) }) : undefined;
  const objectWorkers = deps.objects ? objectMaintenanceWorkers({ ...(deps.objects.transferOwners ? { transferOwners: deps.objects.transferOwners, recoverReads: (uid, digest) => recoverStoppedReads(deps.db, uid, digest) } : {}), catalog: objectCatalog, uploads: objectUploads, content: objectContent, recovery: objectRecoveryRepository(deps.db), plane: deps.objects.plane, owner: objectOwner, logger }) : [];
  const objectBusiness = deps.objects?.sources ? objectService({ catalog: objectCatalog, reads: objectReadRepository(deps.db), uploads: objectUploads, content: objectContent, plane: deps.objects.plane, sources: deps.objects.sources, owner: objectOwner }) : undefined;
  const archives = deps.objects?.sources && deps.objects.tasks ? archiveService({ plans: archivePlanRepository(deps.db), sources: deps.objects.sources, tasks: deps.objects.tasks, catalog: objectCatalog }) : undefined;
  const helperStore = archiveHelperRepository(deps.db);
  const helper = deps.objects ? archiveHelpers({ helpers: helperStore, bindings: archiveBindingRepository(deps.db), plans: archivePlanRepository(deps.db), catalog: objectCatalog, uploads: objectUploads, plane: deps.objects.plane, owner: objectOwner, secretKeyBase64: deps.settings.secretKeyBase64 }) : undefined;
  const archiveApi = deps.objects?.tasks ? archiveFinalization(archiveBindingRepository(deps.db), deps.objects.tasks, { plans: archivePlanRepository(deps.db), reads: objectReadRepository(deps.db), helpers: helperStore }) : undefined;
  const archiveAdmin = deps.objects?.tasks ? archiveAdministration({ plans: archivePlanRepository(deps.db), catalog: objectCatalog, tasks: deps.objects.tasks, authorizer: deps.authorizer, bindings: archiveBindingRepository(deps.db), loss: archiveLossRepository(deps.db) }) : undefined;
  const api: DataModuleApi = { taskStorageStatus: taskStorageStatus(objectCatalog, storageContractRepository(deps.db)), ...(inputs ? { taskInputs: inputs } : {}), storageContract: storageContractRepository(deps.db), ...(archiveAdmin ? { archiveAdministration: archiveAdmin } : {}), ...(archives ? { archiveService: archives } : {}), ...(helper ? { archiveHelper: helper } : {}), ...(archiveApi ? { archiveFinalization: archiveApi } : {}), name: 'data', applyObjectWriteControl: objectCatalog.applyWriteControl, ensureServiceData: service.ensureServiceData, envFor: service.envFor, listResources: service.listResources, rotateCredential: rotateCredentialUseCase(useCaseDeps), ...bindings, ...(objects ? { objects } : {}), ...(objectBusiness ? { objectService: objectBusiness } : {}), ...(deps.objects?.provisioning ? { objectEnv: objectProvisioning(objectCatalog, deps.services, deps.objects.provisioning) } : {}) };
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
  const resync = projection ? [dataLedgerResyncWorker(() => projection.resync(stored.resources, stored.bindings), logger)] : [];
  const internalHttp = deps.objects ? [objectMetricsExporter(deps.objects.plane.metrics, deps.objects.exporterToken)] : [];
  const transferHttp = [...(inputs ? [taskInputRoutes(inputs)] : []), ...(helper ? [archiveHelperRoutes(helper)] : []), ...(archives ? [archiveServiceRoutes(archives)] : []), ...(objectBusiness ? [objectServiceRoutes(objectBusiness)] : []), ...(objects ? [objectAdminRoutes(objects, deps.isAdmin)] : [])];
  return { api, http: [dataRoutes(api, deps.isAdmin), ...transferHttp, ...internalHttp], transferHttp, internalHttp, workers: [expiry, ...resync, ...objectWorkers, ...(objectProjection ? [dataLedgerResyncWorker(objectProjection.resync, logger, 30_000)] : [])], subscriptions: [consumer], migrations: dataMigrations };
}

/** Explicit offline/operator workflow; never installed as a user or service write route. */
export function createObjectBackupTools(db: Database, bytes: ObjectBytes & Partial<ObjectRestorePlane>) {
  const backups = objectBackupRepository(db);
  return { ...(bytes.prepareRestore ? { restore: restoreObjectOperations({ backups, restore: objectRestoreRepository(db), plane: bytes as ObjectBytes & ObjectRestorePlane }) } : {}), ...objectBackupOperations({ backups, catalog: objectCatalogRepository(db), bytes }), fileBundle: fileBackupBundle, readBundle: readBackupBundle,
    verifyRestore: (bundle: VerifiedBackupBundle, digest: string, signal: AbortSignal) => verifyRestoredObjects({ backups, bytes }, bundle, digest, signal) };
}
