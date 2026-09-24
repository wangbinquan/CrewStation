import type { MiddlewareRender } from '../domain/middlewareRender';
import type { RouteRender } from '../domain/routeRender';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';

/** 说明页（RFC-025 设计 §7.2，cs-api 渲染）：所在的 Service 与路径前缀，后面接路由记录 ID。 */
export interface Explainer {
  readonly namespace: string;
  readonly service: string;
  readonly port: number;
  readonly path: string;
}

/** 路由目标（槽的 Service）的键。 */
export const targetKey = (namespace: string, service: string): string => `${namespace}/${service}`;

/**
 * 槽的 Service → 指向它的路由记录（按调和器见过的路由记下）：槽的阶段一变，就把这些路由排进队列重新核对，
 * 不必等路由记录自己变化。切流换了目标的路由从旧键上摘下。
 */
export function routeTargets() {
  const byTarget = new Map<string, Set<string>>(), byRoute = new Map<string, string>();
  return {
    note(routeId: string, target: string): void {
      const old = byRoute.get(routeId);
      if (old === target) return;
      if (old) byTarget.get(old)?.delete(routeId);
      byRoute.set(routeId, target);
      const routes = byTarget.get(target) ?? new Set<string>();
      routes.add(routeId);
      byTarget.set(target, routes);
    },
    routesOf: (target: string): readonly string[] => [...(byTarget.get(target) ?? [])],
  };
}
export type RouteTargets = ReturnType<typeof routeTargets>;

/** 槽的 Service 变了阶段：把指向它的路由排进队列。 */
export function enqueueRoutesOfSlot(record: LedgerRecordView, targets: RouteTargets | undefined, enqueue: (id: string) => void): void {
  if (record.kind !== 'service-slot' || !targets) return;
  for (const child of record.spec.children) if (child.kind === 'Service' && child.namespace) for (const id of targets.routesOf(targetKey(child.namespace, child.name))) enqueue(id);
}

/**
 * 待验证主机与首次上线前的正式主机（期望里带说明页中间件的路由，D13）：目标 Service 所属的槽「已结束」（已下线、尚未部署）时，
 * 路由改指 cs-api 的说明页——这条路由独用的 replacePath 中间件把路径换成「说明页前缀／路由记录 ID」，接在原中间件链之后
 * （登录与试用权限照旧先过）。返回中间件与改写后的路由；不该给说明页时返回 undefined，路由照期望指向槽的 Service。
 */
export async function explainerFor(deps: { readonly ledger: LedgerObservations; readonly explainer?: Explainer }, record: LedgerRecordView, route: RouteRender): Promise<{ readonly middleware: MiddlewareRender; readonly route: RouteRender } | undefined> {
  if (!deps.explainer || !route.unavailable) return undefined;
  const slotId = await deps.ledger.claimOf({ kind: 'Service', namespace: route.target.namespace, name: route.target.service });
  const slot = slotId ? await deps.ledger.get(slotId) : undefined;
  if (slot?.kind !== 'service-slot' || slot.desired !== 'present' || slot.phase !== 'stopped') return undefined;
  const middleware: MiddlewareRender = { namespace: route.namespace, name: route.unavailable.middleware, replacePath: { path: `${deps.explainer.path}/${record.id}` } };
  const { namespace, service, port } = deps.explainer;
  return { middleware, route: { ...route, target: { namespace, service, port }, middlewares: [...route.middlewares, { name: middleware.name }] } };
}
