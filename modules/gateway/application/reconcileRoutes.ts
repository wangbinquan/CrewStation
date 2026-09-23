import type { RouteEntry, ServiceId } from '@crewstation/contracts';
import type { RoutedService } from '../domain/routeProjection';
import { projectRoute, routeRef, SERVICE_ROUTE_KINDS } from '../domain/routeProjection';
import { planServiceRoutes } from '../domain/routePlan';
import type { RouteLedger } from '../ports/ledger';
import type { GatewayUseCaseDeps } from './dependencies';

const RETIRED = { code: 'route-retired', message: '服务已归档或不再需要这条路由' };
/** 同一种路由摘掉又出现的次数上限：远超实际，只防台账数据异常时无休止地找下去。 */
const MAX_ROUTE_RECORDS = 64;

/** 这一种路由眼下的记录：顺着第几条找到第一条还在用的；前面的都已释放时，给出下一条空着的引用。 */
async function currentRoute(ledger: RouteLedger, serviceId: string, kind: RouteEntry['kind']) {
  for (let nth = 1; nth <= MAX_ROUTE_RECORDS; nth += 1) {
    const ref = routeRef(serviceId, kind, nth);
    const record = await ledger.find(ref, 'route');
    if (!record || record.desired === 'present') return { ref, record };
  }
  throw new Error(`路由 ${routeRef(serviceId, kind)} 已有 ${MAX_ROUTE_RECORDS} 条释放过的记录`);
}

/**
 * 路由投影进资源台账（RFC-025 第三期后半）：计划里的每条声明到它眼下那条记录（同样的期望台账不写库），不在计划里的几种标「不要了」。
 * 台账写失败只告警，不挡路由生效；漏掉的由补投影追上。
 */
export async function syncRouteLedger(deps: Pick<GatewayUseCaseDeps, 'ledger' | 'logger'>, service: RoutedService, routes: readonly RouteEntry[]): Promise<void> {
  const ledger = deps.ledger;
  if (!ledger) return;
  try {
    for (const route of routes) await ledger.declare(projectRoute(service, route, (await currentRoute(ledger, service.serviceId, route.kind)).ref));
    const planned = new Set(routes.map((route) => route.kind));
    for (const kind of SERVICE_ROUTE_KINDS.filter((entry) => !planned.has(entry))) {
      const { record } = await currentRoute(ledger, service.serviceId, kind);
      if (record) await ledger.requestRelease(record.id, RETIRED);
    }
  } catch (error) {
    deps.logger.warn('resource ledger route projection failed', { serviceId: service.serviceId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** 路由生成是幂等的：任何触发（建项目、切流、发布登记）都重算该服务的全部路由再 apply。 */
export function routeUseCases(deps: GatewayUseCaseDeps) {
  const names = {
    systemNamespace: deps.settings.systemNamespace,
    userAuthMiddleware: deps.settings.userAuthMiddleware,
    serviceAuthMiddleware: deps.settings.serviceAuthMiddleware,
    dropIdentityHeadersMiddleware: deps.settings.dropIdentityHeadersMiddleware,
  };
  const reconcileService = async (serviceId: ServiceId): Promise<RouteEntry[]> => {
    const svc = await deps.services.getService(serviceId);
    // 已归档的服务解析得到、但不再生成路由：解析范围放宽是为了删得掉它，不是为了让它复活。
    if (!svc || svc.archived) return [];
    const roles = (await deps.slots.slotRoles(serviceId)) ?? { prod: 'blue' as const, preview: 'green' as const };
    const proxyName = await deps.grants.proxyNameOf(serviceId);
    const routes = planServiceRoutes({
      projectSlug: svc.projectSlug, serviceName: svc.serviceName, namespace: svc.namespace,
      prodPhysical: roles.prod, previewPhysical: roles.preview,
      hosts: { prod: deps.hosts.prodHost(svc.projectSlug), preview: deps.hosts.previewHost(svc.projectSlug), service: deps.hosts.serviceHost(svc.serviceName) },
      ...(proxyName ? { proxyName } : {}), platformApiHost: deps.hosts.platformApiHost(),
    }, names);
    await deps.applier.applyRoutes(svc.serviceName, svc.namespace, routes);
    await deps.routes.saveForService(svc.serviceId, svc.serviceName, routes);
    await syncRouteLedger(deps, svc, routes);
    deps.logger.info('routes reconciled', { service: svc.identity, routes: routes.length });
    return routes;
  };
  return {
    reconcileService,
    reconcileAll: async (): Promise<number> => {
      let n = 0;
      for (const svc of await deps.services.listServices()) n += (await reconcileService(svc.serviceId)).length;
      return n;
    },
    removeService: async (serviceId: ServiceId): Promise<void> => {
      const svc = await deps.services.getService(serviceId);
      if (!svc) return;
      await deps.applier.removeRoutes(svc.serviceName, svc.namespace);
      await deps.routes.saveForService(svc.serviceId, svc.serviceName, []);
      await syncRouteLedger(deps, svc, []);
    },
    /**
     * 路由的台账补投影（RFC-025 第三期后半）：按网关自己存的路由表逐个服务再投影一次，部署时已有的路由由它第一次写进台账。
     * 不重新 apply IngressRoute；归档的服务照空计划投影（它的记录标「不要了」）。
     */
    resyncRouteLedger: async (): Promise<number> => {
      if (!deps.ledger) return 0;
      let synced = 0;
      for (const entry of await deps.routes.listAll()) {
        const svc = await deps.services.getService(entry.serviceId as ServiceId);
        if (!svc) continue;
        await syncRouteLedger(deps, svc, svc.archived ? [] : entry.routes);
        synced += 1;
      }
      return synced;
    },
    listRoutes: () => deps.routes.listAll(),
  };
}
