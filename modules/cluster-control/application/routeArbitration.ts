import { routeRenderOf } from '../domain/routeRender';
import type { LedgerRecordView, LedgerObservations } from '../ports/ledger';
import type { ClusterWriter, ManagedObjectFeed, ManagedObjectReader } from '../ports/cluster';
import type { ObservationStats } from './observeChange';
import type { RouteTargets } from './routeExplainer';

interface ArbitrationDeps {
  readonly ledger: LedgerObservations;
  readonly reader?: ManagedObjectReader;
  readonly feed: ManagedObjectFeed;
  readonly cluster: ClusterWriter;
  readonly stats: ObservationStats;
  readonly systemNamespace: string;
  readonly routeTargets?: RouteTargets;
  readonly signal?: AbortSignal;
  readonly retryMs?: number;
}
type Enqueue = (id: string, afterMs?: number) => void;
import { targetKey } from './routeExplainer';

/** Host 不区分大小写、末尾根域点；PathPrefix 保留原始匹配语义。 */
export const normalizedHost = (host: string): string => host.toLowerCase().replace(/\.$/, '');
export const routeMatchKey = (host: string, pathPrefix?: string): string => JSON.stringify([normalizedHost(host), pathPrefix ?? '']);

/** 相同优先级按记录 ID 升序，避免输入顺序或副本不同造成来回切换。 */
export async function winningRoute(records: readonly LedgerRecordView[], parent: (id: string) => Promise<LedgerRecordView | undefined>): Promise<LedgerRecordView | undefined> {
  const ranked = await Promise.all(records.filter((record) => record.desired === 'present').map(async (record) => {
    const upper = record.parentId ? await parent(record.parentId) : undefined;
    const rank = upper?.desired === 'present' ? (upper.phase === 'ready' ? 2 : upper.phase === 'starting' ? 1 : 0) : 0;
    return { record, rank };
  }));
  return ranked.sort((a, b) => b.rank - a.rank || a.record.id.localeCompare(b.record.id))[0]?.record;
}

/**
 * 同入口的物理切换在调和器租约内完成。直接列 API Server，避免 watch 延迟把刚建出的旧路由误判为不存在。
 * 先删败选项，再等下一轮确认消失；不删 Service 或中间件。没有完整候选集时拒绝应用。
 */
export async function arbitrateRoute(deps: ArbitrationDeps, record: LedgerRecordView, enqueue: Enqueue): Promise<boolean> {
  const route = routeRenderOf(record.spec);
  if (!route || route.namespace === deps.systemNamespace) return false;
  const key = routeMatchKey(route.host, route.pathPrefix);
  const listed = deps.ledger.routeCandidates ? await deps.ledger.routeCandidates(normalizedHost(route.host), route.pathPrefix) : await deps.ledger.listLive();
  if (listed.length >= 2000) throw new Error('路由候选集达到查询上限，拒绝不完整的入口仲裁');
  const candidates = listed.filter((entry) => {
    const value = entry.kind === 'route' ? routeRenderOf(entry.spec) : undefined;
    return value && value.namespace !== deps.systemNamespace && routeMatchKey(value.host, value.pathPrefix) === key;
  });
  // 尚未出现在测试替身的列表里的当前记录也必须参与；生产列表与 get 同源。
  if (!candidates.some((entry) => entry.id === record.id)) candidates.push(record);
  const ranked = await Promise.all(candidates.map(async (entry) => {
    const value = routeRenderOf(entry.spec)!;
    deps.routeTargets?.note(entry.id, targetKey(value.target.namespace, value.target.service));
    const parentId = entry.parentId ?? await deps.ledger.claimOf({ kind: 'Service', namespace: value.target.namespace, name: value.target.service });
    if (parentId) deps.routeTargets?.noteParent(entry.id, parentId);
    return { ...entry, ...(parentId ? { parentId } : {}) };
  }));
  const winner = await winningRoute(ranked, (id) => deps.ledger.get(id));
  const live = deps.reader ? await deps.reader.list('IngressRoute') : deps.feed.list('IngressRoute');
  let removing = false;
  for (const entry of candidates) {
    if (entry.id === winner?.id) continue;
    const value = routeRenderOf(entry.spec)!;
    deps.signal?.throwIfAborted();
    if (entry.desired === 'present') await deps.ledger.observeConditions(entry.id, [{ type: 'Superseded', status: 'true', reason: 'route-superseded', message: `同一入口由资源 ${winner?.id ?? '无'} 提供，当前路由已停用` }]);
    const current = live.find((obj) => obj.metadata.namespace === value.namespace && obj.metadata.name === value.name);
    if (!current) continue;
    removing = true;
    if (current.metadata.uid && !current.metadata.deletionTimestamp) {
      deps.signal?.throwIfAborted();
      await deps.cluster.remove({ kind: 'IngressRoute', namespace: value.namespace, name: value.name, uid: current.metadata.uid });
      deps.stats.removed += 1;
    }
  }
  if (!winner) return false;
  deps.signal?.throwIfAborted();
  await deps.ledger.observeConditions(winner.id, [{ type: 'Superseded', status: 'false' }]);
  if (removing) enqueue(winner.id, deps.retryMs ?? 2000);
  else if (winner.id !== record.id) enqueue(winner.id);
  return !removing && winner.id === record.id;
}
