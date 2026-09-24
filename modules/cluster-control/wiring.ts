import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { forbidden, noopLogger, systemClock, validation } from '@crewstation/kernel';
import type { Hono } from 'hono';
import type { ClusterControlModuleApi } from './api/moduleApi';
import { kubernetesClusterWriter, managedObjectFeed, managedObjectReader } from './adapters/k8s/managedObjects';
import { adoptionReport } from './application/adoptionReport';
import type { ObservationStats } from './application/observeChange';
import { newObservationStats, observeChange } from './application/observeChange';
import { sweepOrphans } from './application/orphanSweep';
import { reconcileRecord } from './application/reconcileObservations';
import type { Explainer } from './application/routeExplainer';
import { routeTargets } from './application/routeExplainer';
import { adoptionRoutes } from './http/adoptionRoutes';
import type { ClusterWriter, ManagedObjectFeed, ManagedObjectReader, ObjectChange, ObservedKind, PodSubscriber } from './ports/cluster';
import type { LedgerObservations, LegacyOwners, SlotOwners, WorkloadOwners } from './ports/ledger';
import { slotRenderOf } from './domain/slotRender';
import type { LedgerReconcilerOptions, ReplicaLeases } from './workers/ledgerReconciler';
import { ledgerReconciler } from './workers/ledgerReconciler';
import { observationWorker } from './workers/observationWorker';
import type { OrphanSweeperOptions } from './workers/orphanSweeper';
import { orphanSweeper } from './workers/orphanSweeper';

/**
 * 调和器按期望渲染的种类：有人改了它们（标签、命名空间的额度上限）时 generation 不一定变、台账不记变更，
 * 所以观测到变化就直接核对认领它的记录，缺了或被改就改回。工作卷（I25）观测到了，认领它的卷记录随即唤醒等着它的工作区。
 * 服务槽的 Deployment 与 Service（T8）同样：被人改了标签、副本或镜像，随即按期望改回。
 */
const RENDERED_KINDS: ReadonlySet<ObservedKind> = new Set(['IngressRoute', 'Middleware', 'Namespace', 'ResourceQuota', 'NetworkPolicy', 'PersistentVolumeClaim', 'Deployment', 'Service']);

/** 装配期注入：台账入口与旧所属对象由组合根从 resources／task-runtime 接上。 */
export interface ClusterControlModuleDeps {
  readonly k8s: K8sClient;
  readonly ledger: LedgerObservations;
  readonly legacy: LegacyOwners;
  /** 平台组件所在的系统命名空间：不在收编与回收范围。 */
  readonly systemNamespace: string;
  isAdmin(id: UserId): Promise<boolean>;
  readonly logger?: Logger;
  readonly clock?: Clock;
  /** 测试替身：不给就用真实集群的观测缓存与列表。 */
  readonly feed?: ManagedObjectFeed;
  readonly reader?: ManagedObjectReader;
  /** 调和器对集群的删除；不给就用真实集群（用例给假的）。 */
  readonly cluster?: ClusterWriter;
  /** 观测到的 Pod 交给身份索引（gateway）；不给就不转交。 */
  readonly pods?: PodSubscriber;
  readonly summaryMs?: number;
  readonly reconciler?: LedgerReconcilerOptions;
  /** 多副本分工（设计 §6.3）：逐条调和与孤儿回收在租约下进行；不给就不分工。 */
  readonly leases?: ReplicaLeases;
  /** 孤儿回收（设计 §6.4）：false 关掉；缺省建出满 10 分钟才判孤儿，同步后 10 分钟起每 10 分钟一轮。 */
  readonly orphanSweep?: false | (OrphanSweeperOptions & { readonly minAgeMs?: number });
  /** 说明页（RFC-025 设计 §7.2，D13）：槽「已结束」时待验证与正式主机改指 cs-api 的这个路径；不给就不改指。 */
  readonly explainer?: Explainer;
  /** 工作区容器的所属模块（task-runtime，RFC-025 I25）：给了就照工作区与工作卷记录建出容器。 */
  readonly workloads?: WorkloadOwners;
  /** 服务槽的所属模块（release，T8）：给了就照槽记录建出 Deployment、Service 与环境 Secret。 */
  readonly slots?: SlotOwners;
}

export interface ClusterControlModule {
  readonly api: ClusterControlModuleApi;
  readonly http: Hono<AppEnv>[];
  /** cs-controller：观测受管对象并写回台账。 */
  readonly observer: { start(): void; stop(): Promise<void> };
  stats(): Readonly<ObservationStats>;
  /** 按记录核对的队列处理完（用例用）。 */
  reconciled(): Promise<void>;
}

export function createClusterControlModule(deps: ClusterControlModuleDeps): ClusterControlModule {
  const logger = deps.logger ?? noopLogger, clock = deps.clock ?? systemClock;
  const reader = deps.reader ?? managedObjectReader(deps.k8s);
  const feed = deps.feed ?? managedObjectFeed(deps.k8s, { logger });
  const stats = newObservationStats();
  const cluster = deps.cluster ?? kubernetesClusterWriter(deps.k8s);
  const api: ClusterControlModuleApi = {
    name: 'cluster-control',
    adoptionReport: async (actor) => {
      if (!actor.isAdmin) throw forbidden('只有管理员可以查看收编报告');
      return adoptionReport({ reader, ledger: deps.ledger, legacy: deps.legacy, clock, systemNamespace: deps.systemNamespace });
    },
    dryRunSlot: async (spec, values) => {
      const slot = slotRenderOf(spec);
      if (!slot) throw validation('服务槽的期望不完整，无法预检');
      await cluster.dryRunSlot(slot, 0, values);
    },
  };
  const reconcileDeps = {
    ledger: deps.ledger, feed, cluster, clock, systemNamespace: deps.systemNamespace, stats, logger, routeTargets: routeTargets(),
    ...(deps.reconciler?.retryMs ? { retryMs: deps.reconciler.retryMs } : {}), ...(deps.explainer ? { explainer: deps.explainer } : {}), ...(deps.workloads ? { workloads: deps.workloads } : {}),
    ...(deps.slots ? { slots: deps.slots } : {}),
  };
  const reconciler = ledgerReconciler(deps.ledger, feed, (id, enqueue) => reconcileRecord(reconcileDeps, id, enqueue), logger, { ...deps.reconciler, ...(deps.leases ? { leases: deps.leases } : {}) });
  // Pod 先交给身份索引（来源 IP 认人，越早越好），再写台账观测；两边失败互不耽误。调和器渲染的对象一有变化就把认领它的记录排进去核对。
  const handle = async (change: ObjectChange) => {
    if (change.kind === 'Pod' && deps.pods) await deps.pods.changed(change.object, change.gone).catch((error: unknown) => logger.warn('pod identity sync failed', { name: change.object.metadata.name, error: String(error) }));
    const owner = await observeChange(deps.ledger, clock, deps.systemNamespace, stats, change);
    if (owner && RENDERED_KINDS.has(change.kind)) reconciler.enqueue(owner.id);
  };
  const watcher = observationWorker(feed, handle, () => ({ ...stats }), logger, deps.summaryMs);
  const sweep = deps.orphanSweep === false ? undefined : orphanSweeper(feed, () => sweepOrphans({ feed, ledger: deps.ledger, legacy: deps.legacy, cluster, clock, logger, stats, systemNamespace: deps.systemNamespace, minAgeMs: (deps.orphanSweep || {}).minAgeMs ?? 600_000 }), logger, { ...(deps.orphanSweep || {}), ...(deps.leases ? { leases: deps.leases } : {}) });
  // 先开观测缓存，再开按记录核对的队列与孤儿回收（它们都等缓存同步完成才开始）；同步完成后身份索引按全量清一次旧行。
  const observer = {
    start: () => {
      watcher.start(); reconciler.start(); sweep?.start();
      if (deps.pods) {
        const pods = deps.pods;
        void feed.synced().then(() => pods.synced(feed.list('Pod'))).catch((error: unknown) => logger.warn('pod identity relist failed', { error: String(error) }));
      }
    },
    stop: async () => { await sweep?.stop(); await reconciler.stop(); await watcher.stop(); },
  };
  return { api, http: [adoptionRoutes(api, (id) => deps.isAdmin(id as UserId))], observer, stats: () => ({ ...stats }), reconciled: () => reconciler.drained() };
}
