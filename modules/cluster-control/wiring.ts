import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { forbidden, noopLogger, systemClock } from '@crewstation/kernel';
import type { Hono } from 'hono';
import type { ClusterControlModuleApi } from './api/moduleApi';
import { managedObjectFeed, managedObjectReader } from './adapters/k8s/managedObjects';
import { adoptionReport } from './application/adoptionReport';
import type { ObservationStats } from './application/observeChange';
import { newObservationStats, observeChange } from './application/observeChange';
import { adoptionRoutes } from './http/adoptionRoutes';
import type { ManagedObjectFeed, ManagedObjectReader } from './ports/cluster';
import type { LedgerObservations, LegacyOwners } from './ports/ledger';
import { observationWorker } from './workers/observationWorker';

/** 装配期注入：台账入口与旧所属对象由组合根从 resources／task-runtime 接上。 */
export interface ClusterControlModuleDeps {
  readonly k8s: K8sClient;
  readonly ledger: LedgerObservations;
  readonly legacy: LegacyOwners;
  isAdmin(id: UserId): Promise<boolean>;
  readonly logger?: Logger;
  readonly clock?: Clock;
  /** 测试替身：不给就用真实集群的观测缓存与列表。 */
  readonly feed?: ManagedObjectFeed;
  readonly reader?: ManagedObjectReader;
  readonly summaryMs?: number;
}

export interface ClusterControlModule {
  readonly api: ClusterControlModuleApi;
  readonly http: Hono<AppEnv>[];
  /** cs-controller：观测受管对象并写回台账。 */
  readonly observer: { start(): void; stop(): Promise<void> };
  stats(): Readonly<ObservationStats>;
}

export function createClusterControlModule(deps: ClusterControlModuleDeps): ClusterControlModule {
  const logger = deps.logger ?? noopLogger, clock = deps.clock ?? systemClock;
  const reader = deps.reader ?? managedObjectReader(deps.k8s);
  const feed = deps.feed ?? managedObjectFeed(deps.k8s, { logger });
  const stats = newObservationStats();
  const api: ClusterControlModuleApi = {
    name: 'cluster-control',
    adoptionReport: async (actor) => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以查看收编报告');
      return adoptionReport({ reader, ledger: deps.ledger, legacy: deps.legacy, clock });
    },
  };
  const observer = observationWorker(feed, (change) => observeChange(deps.ledger, clock, stats, change), () => ({ ...stats }), logger, deps.summaryMs);
  return { api, http: [adoptionRoutes(api, (id) => deps.isAdmin(id as UserId))], observer, stats: () => ({ ...stats }) };
}
