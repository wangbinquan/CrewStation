import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { DataControlModuleApi } from './api/moduleApi';
import { postgresDataPlane } from './adapters/postgres/postgresDataPlane';
import type { DataObservationStats } from './application/observeDataPlane';
import { newDataObservationStats } from './application/observeDataPlane';
import type { DataPlaneReader } from './ports/dataPlane';
import type { DataLedgerObservations } from './ports/ledger';
import type { DataPlaneObserverOptions } from './workers/dataPlaneObserver';
import { dataPlaneObserver } from './workers/dataPlaneObserver';

/** 装配期注入：台账入口由组合根从 resources 接上；数据面用与 data 供给同一个管理连接。 */
export interface DataControlModuleDeps {
  readonly ledger: DataLedgerObservations;
  /** 平台数据库集群的管理连接；给了 reader（用例）就不用。 */
  readonly adminUrl?: string;
  readonly reader?: DataPlaneReader;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly observer?: DataPlaneObserverOptions;
}

export interface DataControlModule {
  readonly api: DataControlModuleApi;
  /** cs-controller：观测数据面上的库与角色写回台账。 */
  readonly observer: { start(): void; stop(): Promise<void> };
  stats(): Readonly<DataObservationStats>;
}

export function createDataControlModule(deps: DataControlModuleDeps): DataControlModule {
  const logger = deps.logger ?? noopLogger;
  const reader = deps.reader ?? (deps.adminUrl ? postgresDataPlane(deps.adminUrl, deps.clock ?? systemClock) : undefined);
  if (!reader) throw new Error('data-control 需要数据面的管理连接（adminUrl）或 reader');
  const stats = newDataObservationStats();
  const observer = dataPlaneObserver(deps.ledger, reader, stats, logger, deps.observer);
  return { api: { name: 'data-control' }, observer, stats: () => ({ ...stats }) };
}
