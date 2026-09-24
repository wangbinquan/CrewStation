import { join } from 'node:path';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import type { DataControlModuleApi } from './api/moduleApi';
import { secretboxCipher } from './adapters/crypto/secretboxCipher';
import { drizzleCredentialStore } from './adapters/persistence/credentialStore';
import { postgresDataPlane } from './adapters/postgres/postgresDataPlane';
import { credentialOf, provisionDatabase } from './application/provisionDatabase';
import type { DataObservationStats } from './application/observeDataPlane';
import { newDataObservationStats } from './application/observeDataPlane';
import type { DataPlaneReader, DataPlaneWriter } from './ports/dataPlane';
import type { DataLedgerObservations } from './ports/ledger';
import type { DataPlaneObserverOptions } from './workers/dataPlaneObserver';
import { dataPlaneObserver } from './workers/dataPlaneObserver';

/** 装配期注入：台账入口由组合根从 resources 接上；数据面用与 data 供给同一个管理连接。 */
export interface DataControlModuleDeps {
  readonly ledger: DataLedgerObservations;
  /** 平台数据库集群的管理连接；给了 plane（用例）就不用。 */
  readonly adminUrl?: string;
  readonly plane?: DataPlaneReader & DataPlaneWriter;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly observer?: DataPlaneObserverOptions;
  /** RFC-025 I28：口令表所在的平台库与平台密钥；都给了才建库、才答得出 credentialOf。 */
  readonly db?: Database;
  readonly secretKeyBase64?: string;
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
  const plane = deps.plane ?? (deps.adminUrl ? postgresDataPlane(deps.adminUrl, deps.clock ?? systemClock) : undefined);
  if (!plane) throw new Error('data-control 需要数据面的管理连接（adminUrl）或 plane');
  const stats = newDataObservationStats();
  // 口令（I28）：生成、加密存下都在 data-control；没给平台库或密钥时只观测、不建库。
  const vault = deps.db && deps.secretKeyBase64 ? { store: drizzleCredentialStore(deps.db), cipher: secretboxCipher(deps.secretKeyBase64) } : undefined;
  const apply = vault ? (snapshot: Parameters<typeof provisionDatabase>[1], record: Parameters<typeof provisionDatabase>[2]) => provisionDatabase({ ledger: deps.ledger, plane, stats, logger, ...vault }, snapshot, record) : undefined;
  const observer = dataPlaneObserver(deps.ledger, plane, stats, logger, deps.observer, apply);
  const api: DataControlModuleApi = { name: 'data-control', credentialOf: async (resourceId) => (vault ? credentialOf(vault, resourceId) : undefined) };
  return { api, migrations: dataControlMigrations, observer, stats: () => ({ ...stats }) };
}
