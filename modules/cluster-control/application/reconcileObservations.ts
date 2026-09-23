import type { Clock } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import type { ManagedObjectFeed, ObservedKind } from '../ports/cluster';
import type { LedgerObservations } from '../ports/ledger';
import type { ObservationStats } from './observeChange';
import { observeChange } from './observeChange';

const OBSERVED: readonly string[] = ['Pod', 'PersistentVolumeClaim'];
const isObserved = (kind: string): kind is ObservedKind => OBSERVED.includes(kind);
const key = (child: { readonly kind: string; readonly namespace?: string; readonly name: string }) => `${child.kind}/${child.namespace ?? ''}/${child.name}`;

export interface ReconcileDeps {
  readonly ledger: LedgerObservations;
  readonly feed: ManagedObjectFeed;
  readonly clock: Clock;
  readonly systemNamespace: string;
  readonly stats: ObservationStats;
}

/**
 * 按记录核对子对象的观测（设计 §6.2 第 3 步）：记录是在对象建好之后才声明的（第二期起所属模块补写台账、收编），
 * 观测事件不会再来一次，所以记录一有变化就按它的期望去观测缓存里找——缓存里有的补一条观测，
 * 缓存里没有、台账却记着在的补一条消失。同样的观测台账自己去重，重复核对不写库。只在观测缓存同步完成后调用。
 */
export async function reconcileObservations(deps: ReconcileDeps, id: string): Promise<void> {
  const record = await deps.ledger.get(id);
  if (!record) return;
  const expected = new Set(record.spec.children.map(key));
  const targets = [...record.spec.children, ...record.children.filter((child) => !expected.has(key(child)))];
  for (const child of targets) {
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
