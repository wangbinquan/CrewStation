import { join } from 'node:path';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, Executor, MigrationSet, Transaction } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import type { ProjectId } from '@crewstation/contracts';
import type { DataControlModuleApi } from './api/moduleApi';
import { secretboxCipher } from './adapters/crypto/secretboxCipher';
import { drizzleCredentialStore } from './adapters/persistence/credentialStore';
import { postgresDataPlane } from './adapters/postgres/postgresDataPlane';
import { postgresDatabaseReclamation } from './adapters/postgres/databaseReclamation';
import type { DatabaseReclamationReader } from './api/databaseReclamation';
import type { NativePostgresOrigin, NativePostgresProcesses } from './api/databaseRemoval';
import { markNativeCredentialTransaction, nativePostgresWork } from './adapters/persistence/nativeWork';
import { stageCredentialRotation, finishCredentialRotation } from './application/rotateCredential';
import { credentialOf, prepareProvisionCredential, provisionDatabase, seedNativeCredential } from './application/provisionDatabase';
import type { DataObservationStats } from './application/observeDataPlane';
import { newDataObservationStats } from './application/observeDataPlane';
import type { DataPlaneReader, DataPlaneWriter } from './ports/dataPlane';
import type { DataLedgerObservations } from './ports/ledger';
import type { DataPlaneObserverOptions } from './workers/dataPlaneObserver';
import { dataPlaneObserver } from './workers/dataPlaneObserver';
import { objectEndpointStore } from './adapters/persistence/objectEndpoints';
import { probeObjectBucket } from './adapters/http/objectProbe';
import { observeGarage } from './adapters/http/garageObservation';
import { s3ObjectPlane } from './adapters/http/s3Objects';
import { objectEndpointUseCases } from './application/objectEndpoints';
import { objectTransferMetrics } from './application/objectMetrics';
import { prepareObjectCredentialRotation } from './application/objectCredentialRotation';
import { prepareObjectRestore } from './application/objectRestore';

/** 装配期注入：台账入口由组合根从 resources 接上；数据面用与 data 供给同一个管理连接。 */
export interface DataControlModuleDeps {
  readonly ledger: DataLedgerObservations;
  /** 平台数据库集群的管理连接；给了 plane（用例）就不用。 */
  readonly adminUrl?: string;
  readonly plane?: DataPlaneReader & DataPlaneWriter;
  readonly databaseReclamation?: DatabaseReclamationReader;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly observer?: DataPlaneObserverOptions;
  /** RFC-025 I28：口令表所在的平台库与平台密钥；都给了才建库、才答得出 credentialOf。 */
  readonly db?: Database;
  readonly secretKeyBase64?: string;
  readonly projectAvailable?: (id: ProjectId) => Promise<void>;
  readonly processes?: NativePostgresProcesses;
}

export const dataControlMigrations: MigrationSet = {
  module: 'data_control',
  layer: 2,
  files: readMigrationDir(join(import.meta.dir, 'adapters', 'persistence', 'migrations')),
};

export interface DataControlModule {
  readonly api: DataControlModuleApi;
  readonly migrations: MigrationSet;
  /** cs-controller：观测数据面上的库与角色写回台账，删「不要了」的访问绑定还在的临时角色。 */
  readonly observer: { start(): void; stop(): Promise<void> };
  stats(): Readonly<DataObservationStats>;
}

export function createDataControlModule(deps: DataControlModuleDeps): DataControlModule {
  const logger = deps.logger ?? noopLogger;
  const nativeWork = deps.db ? nativePostgresWork({ db: deps.db, adminUrl: deps.adminUrl ?? '', available: deps.projectAvailable, processes: deps.processes }) : undefined;
  const plane = deps.plane ?? (deps.adminUrl ? postgresDataPlane(deps.adminUrl, deps.clock ?? systemClock, nativeWork?.native) : undefined);
  if (!plane) throw new Error('data-control 需要数据面的管理连接（adminUrl）或 plane');
  const stats = newDataObservationStats();
  const databaseReclamation = deps.databaseReclamation ?? (deps.adminUrl ? postgresDatabaseReclamation(deps.adminUrl, deps.clock ?? systemClock) : undefined);
  // 口令（I28）：生成、加密存下都在 data-control；没给平台库或密钥时只观测、不建库。
  const vault = deps.db && deps.secretKeyBase64 ? { store: drizzleCredentialStore(deps.db), cipher: secretboxCipher(deps.secretKeyBase64) } : undefined;
  const forResource = <T>(origin: NativePostgresOrigin | undefined, work: (guard?: Executor) => Promise<T>): Promise<T> => {
    if (!nativeWork) return work();
    if (!origin) throw precondition('数据库口令缺少原项目归属');
    return nativeWork.withResource(origin, work);
  };
  const originOf = async (id: string) => { const record = await deps.ledger.get(id), original = await nativeWork?.originOf(id); if (record?.projectId && original && record.projectId !== original.projectId) throw precondition('原数据库资源不能转归其他项目'); return original ?? (record?.projectId ? { projectId: record.projectId, resourceId: id } : undefined); };
  const apply = vault ? (snapshot: Parameters<typeof provisionDatabase>[1], record: Parameters<typeof provisionDatabase>[2]) => forResource(record.projectId ? { projectId: record.projectId, resourceId: record.id } : undefined, async () => {
    await deps.db!.transaction((tx) => prepareProvisionCredential({ cipher: vault.cipher, store: drizzleCredentialStore(tx) }, snapshot, record));
    return deps.db!.transaction((tx) => provisionDatabase({ ledger: deps.ledger, plane, stats, logger, cipher: vault.cipher, store: drizzleCredentialStore(tx) }, snapshot, record));
  }) : undefined;
  const observer = dataPlaneObserver(deps.ledger, plane, stats, logger, { ...deps.observer, ...(nativeWork ? { sweepNativeCallbacks: nativeWork.sweep } : {}) }, apply);
  const rotationVault = (transaction: object) => {
    if (!vault) throw new Error('未配置口令存储，无法轮换');
    return { cipher: vault.cipher, store: drizzleCredentialStore(transaction as Executor) };
  };
  const api: DataControlModuleApi = {
    name: 'data-control', credentialOf: async (resourceId) => {
      if (!vault) return undefined;
      const origin = await originOf(resourceId);
      if (!origin && !await vault.store.get(resourceId)) return undefined;
      return forResource(origin, () => credentialOf(vault, resourceId));
    },
    withCredentialAdmission: async (resourceId, work) => forResource(await originOf(resourceId), work),
    ...(nativeWork && deps.adminUrl ? { nativePostgres: { ...nativeWork.native, credential: async (origin: NativePostgresOrigin, role: string) => {
      if (!vault) throw precondition('未配置原数据库口令存储');
      return forResource(origin, async () => {
        await deps.db!.transaction((tx) => seedNativeCredential({ cipher: vault.cipher, store: drizzleCredentialStore(tx) }, origin.resourceId, role));
        const stored = await credentialOf(vault, origin.resourceId);
        if (!stored) throw precondition('原数据库口令未持久提交');
        return stored;
      });
    } } } : {}),
    ...(databaseReclamation ? { databaseReclamation } : {}),
    stageRotation: async (id, transaction) => forResource(await originOf(id), async (guard) => { if (guard) await markNativeCredentialTransaction(transaction as Executor, guard); return stageCredentialRotation({ ledger: deps.ledger, ...rotationVault(transaction) }, id); }),
    finishRotation: async (id, transaction) => forResource(await originOf(id), async (guard) => { if (guard) await markNativeCredentialTransaction(transaction as Executor, guard); return finishCredentialRotation({ ledger: deps.ledger, plane, ...rotationVault(transaction) }, id); }),
    ...(vault ? { objects: createObjectPlane(deps.db!, vault.cipher) } : {}),
  };
  return { api, migrations: dataControlMigrations, observer: { start: observer.start, stop: async () => { try { await observer.stop(); } finally { await databaseReclamation?.close(); } } }, stats: () => ({ ...stats }) };
}

function createObjectPlane(db: Database, cipher: ReturnType<typeof secretboxCipher>) {
  const endpoints = objectEndpointUseCases({ store: objectEndpointStore(db), cipher, probe: probeObjectBucket, observePhysical: observeGarage });
  const meter = objectTransferMetrics();
  const prepareRotation = prepareObjectCredentialRotation({ store: objectEndpointStore(db), within: (tx) => objectEndpointStore(tx as Transaction), cipher, probe: probeObjectBucket });
  const restore = prepareObjectRestore({ store: objectEndpointStore(db), within: (tx) => objectEndpointStore(tx as Transaction), cipher, probe: probeObjectBucket });
  const prepareRestore = async (input: Parameters<typeof restore>[0], signal: AbortSignal) => ({ ...await restore(input, signal), bytes: s3ObjectPlane({ endpoint: async (location) => {
    const target = input.find((p) => p.backendId === location.backendId && p.targetRevision === location.placementRevision);
    if (!target) throw new Error('Unselected restore location'); return target;
  } }) });
  return { ...s3ObjectPlane({ endpoint: endpoints.resolve, meter }), configure: endpoints.configure, probe: endpoints.probe, prepareRotation, prepareRestore, metrics: meter.render };
}

/** Trusted operational composition, using the same encrypted endpoint registry as the platform. */
export function createObjectStoragePlane(db: Database, secretKeyBase64: string) {
  return createObjectPlane(db, secretboxCipher(secretKeyBase64));
}
