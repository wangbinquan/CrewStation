import type { Clock, Logger } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import { middlewareRendersOf } from '../domain/middlewareRender';
import { namespaceRenderOf, networkPolicyRendersOf } from '../domain/namespaceRender';
import { controllerOf, crashLoopingOf, RESOURCE_ID_LABEL } from '../domain/observation';
import { routeRenderOf } from '../domain/routeRender';
import type { ClusterWriter, ManagedObjectFeed, ObservedKind } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import type { ObservationStats } from './observeChange';
import { observeChange } from './observeChange';

/** 删的顺序（设计 §6.2）：先工作负载（Deployment、Job、Pod），再 Secret、Service、路由与它引用的中间件；PVC 只随工作卷记录删。 */
const REMOVAL_ORDER: readonly ObservedKind[] = ['Deployment', 'Job', 'Pod', 'Secret', 'Service', 'IngressRoute', 'Middleware', 'PersistentVolumeClaim'];
/** 按记录核对观测的种类：删除的那些，加上命名空间、额度与网络策略（第四期）——这三种调和器只建、只改回，从不删。 */
const OBSERVED: readonly ObservedKind[] = [...REMOVAL_ORDER, 'Namespace', 'ResourceQuota', 'NetworkPolicy'];
const isObserved = (kind: string): kind is ObservedKind => (OBSERVED as readonly string[]).includes(kind);
const key = (child: { readonly kind: string; readonly namespace?: string; readonly name: string }) => `${child.kind}/${child.namespace ?? ''}/${child.name}`;
const RETENTION_EXPIRED = 'retention-expired';
/** 依赖的对象还没建出来时（路由引用的项目中间件、网络策略所在的命名空间），隔多久再核对一次。 */
const WAIT_MS = 2_000;

/** 把一条记录（再）排进调和队列；带延迟的是到期复核（例如崩溃重启的判定窗口过去之后）。 */
export type Enqueue = (id: string, afterMs?: number) => void;

export interface ReconcileDeps {
  readonly ledger: LedgerObservations;
  readonly feed: ManagedObjectFeed;
  readonly cluster: ClusterWriter;
  readonly clock: Clock;
  readonly systemNamespace: string;
  readonly stats: ObservationStats;
  readonly logger: Logger;
  /** 等依赖对象时的复核间隔（用例调短）；缺省 2 秒。 */
  readonly retryMs?: number;
}

/** 期望里的与观测到的子对象（期望里已经没有、但还在集群里的旧对象也在内，例如重建换下的 Pod）。 */
function targetsOf(record: LedgerRecordView): { readonly kind: string; readonly namespace?: string; readonly name: string }[] {
  const expected = new Set(record.spec.children.map(key));
  return [...record.spec.children, ...record.children.filter((child) => !expected.has(key(child)))];
}

/**
 * 按记录核对子对象的观测（设计 §6.2 第 3 步）：记录往往是在对象建好之后才声明的（投影、补投影、收编），
 * 观测事件不会再来一次，所以记录一有变化就按它的期望去观测缓存里找——缓存里有的补一条观测，
 * 缓存里没有、台账却记着在的补一条消失。同样的观测台账自己去重，重复核对不写库。
 */
async function observeRecord(deps: ReconcileDeps, record: LedgerRecordView): Promise<void> {
  for (const child of targetsOf(record)) {
    if (!isObserved(child.kind)) continue;
    const cached = deps.feed.cached(child.kind, child.namespace, child.name);
    const recorded = record.children.find((entry) => key(entry) === key(child));
    if (cached) {
      await observeChange(deps.ledger, deps.clock, deps.systemNamespace, deps.stats, { kind: child.kind, object: cached, gone: false });
      continue;
    }
    if (!recorded || recorded.phase === 'absent') continue;
    const gone: ObservedObject = { kind: child.kind, metadata: { name: child.name, ...(child.namespace ? { namespace: child.namespace } : {}), ...(recorded.uid ? { uid: recorded.uid } : {}) } };
    await observeChange(deps.ledger, deps.clock, deps.systemNamespace, deps.stats, { kind: child.kind, object: gone, gone: true });
  }
}

/**
 * 「不要了」的记录：按顺序删它还在的子对象（设计 §6.2、§6.4）。子对象按名字属于这条记录（台账保证一个名字只属于一条记录），
 * 所以观测缓存里这个名字的实例都要删；删除带着缓存里那个实例的 UID，读缓存与删之间被换成新实例时 API Server 拒绝，下一轮再判断。
 * 删除中的不重复删；系统命名空间里不带任务标签的平台组件一律不碰。请求发出即可，对象消失由观测写回，删完记录进入「已结束」。
 */
async function removeChildren(deps: ReconcileDeps, record: LedgerRecordView): Promise<void> {
  const targets = targetsOf(record);
  for (const kind of REMOVAL_ORDER) {
    if (kind === 'PersistentVolumeClaim' && record.kind !== 'volume') continue;
    for (const child of targets.filter((target) => target.kind === kind)) {
      const cached = deps.feed.cached(kind, child.namespace, child.name), uid = cached?.metadata.uid;
      if (!cached || !uid || cached.metadata.deletionTimestamp) continue;
      if (cached.metadata.namespace === deps.systemNamespace && !cached.metadata.labels?.['crewstation.io/task'] && !cached.metadata.labels?.[RESOURCE_ID_LABEL]) continue;
      await deps.cluster.remove({ kind, ...(cached.metadata.namespace ? { namespace: cached.metadata.namespace } : {}), name: cached.metadata.name, uid });
      deps.stats.removed += 1;
      deps.logger.info('resource child removed', { resourceId: record.id, kind, namespace: cached.metadata.namespace, name: cached.metadata.name, reason: record.releaseReason?.code });
    }
  }
}

/**
 * 工作卷的上级已结束（设计 §6.4、D8、D9）：持久卷，以及失败保留期满的会话的卷，不删，写上「待回收」等管理员确认；
 * 跟随容器的卷由所属模块随释放标成「不要了」，这里不替它决定。
 */
async function settleVolume(deps: ReconcileDeps, volume: LedgerRecordView): Promise<void> {
  if (volume.kind !== 'volume' || volume.desired === 'absent' || !volume.parentId) return;
  if (volume.conditions.some((entry) => entry.type === 'PendingReclaim' && entry.status === 'true')) return;
  const parent = await deps.ledger.get(volume.parentId);
  if (!parent || parent.desired !== 'absent' || parent.phase !== 'stopped') return;
  const expired = parent.releaseReason?.code === RETENTION_EXPIRED;
  if (!expired && volume.spec['reclaim'] !== 'retain') return;
  const message = expired ? '失败会话的保留期已满，容器已回收；工作卷留作待回收，由管理员确认后删除' : '上级已结束，持久工作卷留作待回收，由管理员确认后删除';
  const outcome = await deps.ledger.observeConditions(volume.id, [{ type: 'PendingReclaim', status: 'true', reason: expired ? RETENTION_EXPIRED : 'parent-ended', message }]);
  if (outcome.status === 'recorded') deps.stats.reclaimable += 1;
}

/**
 * 期望里有 Deployment 或 Job 的记录（服务槽、构建、迁移，第三期）：观测缓存里它名下的 Pod 都作为观测到的子对象入账——新建的、
 * 台账接上之前就在的。服务槽再汇总副本写崩溃重启（G22），成立时到期复核，之后不再重启就撤掉。
 */
async function observeControlledPods(deps: ReconcileDeps, record: LedgerRecordView, enqueue: Enqueue): Promise<void> {
  const controllers = new Set(record.spec.children.filter((child) => child.kind === 'Deployment' || child.kind === 'Job').map(key));
  if (!controllers.size || record.desired === 'absent') return;
  const pods = deps.feed.list('Pod').filter((pod) => {
    const controller = controllerOf(pod);
    return controller !== undefined && controllers.has(key(controller));
  });
  const recorded = new Set(record.children.filter((child) => child.kind === 'Pod').map(key));
  for (const pod of pods) {
    if (recorded.has(key({ kind: 'Pod', ...(pod.metadata.namespace ? { namespace: pod.metadata.namespace } : {}), name: pod.metadata.name }))) continue;
    await observeChange(deps.ledger, deps.clock, deps.systemNamespace, deps.stats, { kind: 'Pod', object: pod, gone: false });
  }
  if (!record.spec.children.some((child) => child.kind === 'Deployment')) return;
  const { condition, recheckAfterMs } = crashLoopingOf(pods, deps.clock.now());
  await deps.ledger.observeConditions(record.id, [condition]);
  if (recheckAfterMs !== undefined) enqueue(record.id, recheckAfterMs);
}

type Child = { readonly kind: ObservedKind; readonly namespace?: string; readonly name: string };

/** 按期望应用一个子对象：写入者比对后缺了或不一致才 apply，apply 了就计数并记一行（缺了还是被改了）。 */
async function applyChild(deps: ReconcileDeps, record: LedgerRecordView, child: Child, current: ObservedObject | undefined, apply: () => Promise<'applied' | 'unchanged'>): Promise<void> {
  if ((await apply()) !== 'applied') return;
  deps.stats.applied += 1;
  deps.logger.info('resource child applied', { resourceId: record.id, kind: child.kind, namespace: child.namespace, name: child.name, reason: current ? 'drift' : 'missing' });
}

/**
 * 路由（第三期后半，设计 §7.1）：期望在、IngressRoute 缺了或与期望不一致时按期望 apply——网关写期望，调和器应用。
 * 删除中的等它消失再建；系统命名空间不碰；期望不完整的不渲染，只告警。引用的项目中间件（前缀剥离、限流）还没建出来时先不动：
 * Traefik 遇到不存在的中间件会让整条路由失效，线上那一版照旧服务，过一会儿再核对。
 */
async function applyRoute(deps: ReconcileDeps, record: LedgerRecordView, enqueue: Enqueue): Promise<void> {
  const route = routeRenderOf(record.spec);
  if (!route) {
    deps.logger.warn('resource route spec incomplete', { resourceId: record.id });
    return;
  }
  if (route.namespace === deps.systemNamespace) return;
  const waiting = route.middlewares.find((entry) => (!entry.namespace || entry.namespace === route.namespace) && !deps.feed.cached('Middleware', route.namespace, entry.name));
  if (waiting) {
    deps.logger.debug('resource route waiting for middleware', { resourceId: record.id, middleware: waiting.name });
    enqueue(record.id, deps.retryMs ?? WAIT_MS);
    return;
  }
  const current = deps.feed.cached('IngressRoute', route.namespace, route.name);
  if (current?.metadata.deletionTimestamp) return;
  await applyChild(deps, record, { kind: 'IngressRoute', namespace: route.namespace, name: route.name }, current, () => deps.cluster.applyRoute(route, current));
}

/**
 * 限流策略（第三期后半，T10，设计 §7.3）：期望在、Middleware 缺了或与期望不一致时按期望 apply。系统命名空间里的（平台接口的限流）
 * 同样由它渲染——它们带所属记录的资源 ID 标签，是台账里的对象；删除中的等它消失再建；期望不完整的整条不渲染，只告警。
 */
async function applyMiddlewares(deps: ReconcileDeps, record: LedgerRecordView): Promise<void> {
  const renders = middlewareRendersOf(record.spec);
  if (!renders) {
    deps.logger.warn('resource rate-limit spec incomplete', { resourceId: record.id });
    return;
  }
  for (const middleware of renders) {
    const current = deps.feed.cached('Middleware', middleware.namespace, middleware.name);
    if (current?.metadata.deletionTimestamp) continue;
    await applyChild(deps, record, { kind: 'Middleware', namespace: middleware.namespace, name: middleware.name }, current, () => deps.cluster.applyMiddleware(middleware, record.id, current));
  }
}

/**
 * 命名空间与额度（第四期，设计 §6.2）：期望在、Namespace 或它的额度缺了或与期望不一致（标签、上限被改）时按期望 apply——provisioning 写期望，
 * 调和器应用。先命名空间后额度；命名空间删除中（有人删了它）两样都建不了，等它消失后按「缺了」再建。系统命名空间不碰；
 * 期望不完整的不渲染，只告警。命名空间、额度从不由调和器删除（设计 §6.4）。
 */
async function applyNamespace(deps: ReconcileDeps, record: LedgerRecordView): Promise<void> {
  const render = namespaceRenderOf(record.spec);
  if (!render) {
    deps.logger.warn('resource namespace spec incomplete', { resourceId: record.id });
    return;
  }
  if (render.name === deps.systemNamespace) return;
  const namespace = deps.feed.cached('Namespace', undefined, render.name);
  if (namespace?.metadata.deletionTimestamp) return;
  await applyChild(deps, record, { kind: 'Namespace', name: render.name }, namespace, () => deps.cluster.applyNamespace(render, namespace));
  const quota = deps.feed.cached('ResourceQuota', render.name, render.quota.name);
  if (quota?.metadata.deletionTimestamp) return;
  await applyChild(deps, record, { kind: 'ResourceQuota', namespace: render.name, name: render.quota.name }, quota, () => deps.cluster.applyQuota(render, quota));
}

/**
 * 网络策略（第四期）：期望在、某条缺了或被改时按模板 apply。所在的命名空间还没建出来（或正在删除）时先不动，过一会儿再核对——
 * 命名空间由另一条记录建。只建、只改回，从不删。
 */
async function applyNetworkPolicies(deps: ReconcileDeps, record: LedgerRecordView, enqueue: Enqueue): Promise<void> {
  const renders = networkPolicyRendersOf(record.spec);
  if (!renders) {
    deps.logger.warn('resource network-policy spec incomplete', { resourceId: record.id });
    return;
  }
  for (const policy of renders) {
    if (policy.namespace === deps.systemNamespace) continue;
    const namespace = deps.feed.cached('Namespace', undefined, policy.namespace);
    if (!namespace || namespace.metadata.deletionTimestamp) {
      deps.logger.debug('resource network policy waiting for namespace', { resourceId: record.id, namespace: policy.namespace });
      enqueue(record.id, deps.retryMs ?? WAIT_MS);
      return;
    }
    const current = deps.feed.cached('NetworkPolicy', policy.namespace, policy.name);
    if (current?.metadata.deletionTimestamp) continue;
    await applyChild(deps, record, { kind: 'NetworkPolicy', namespace: policy.namespace, name: policy.name }, current, () => deps.cluster.applyNetworkPolicy(policy, current));
  }
}

/** 按期望应用子对象的种类：写期望的模块只写记录，对象由调和器建出、改回。 */
const APPLIERS: Readonly<Record<string, (deps: ReconcileDeps, record: LedgerRecordView, enqueue: Enqueue) => Promise<void>>> = {
  route: applyRoute, 'rate-limit-policy': applyMiddlewares, namespace: applyNamespace, 'network-policy-set': applyNetworkPolicies,
};

/**
 * 调和一条记录：先按期望补观测；路由、限流中间件、命名空间与网络策略按期望应用；「不要了」的删子对象；工作卷看上级是否已结束。上级进入「已结束」时把挂在它下面的记录
 * 重新排进队列（工作卷的「待回收」要在这之后判定）。只在观测缓存同步完成后调用。
 */
export async function reconcileRecord(deps: ReconcileDeps, id: string, enqueue: Enqueue): Promise<void> {
  const record = await deps.ledger.get(id);
  if (!record) return;
  await observeRecord(deps, record);
  await observeControlledPods(deps, record, enqueue);
  if (record.desired === 'present') await APPLIERS[record.kind]?.(deps, record, enqueue);
  if (record.desired === 'absent') await removeChildren(deps, record);
  await settleVolume(deps, record);
  if (record.kind !== 'volume' && record.desired === 'absent' && record.phase === 'stopped') {
    for (const child of await deps.ledger.children(record.id)) enqueue(child.id);
  }
}
