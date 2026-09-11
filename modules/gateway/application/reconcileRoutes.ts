import type { RouteEntry, ServiceId } from '@crewstation/contracts';
import { planServiceRoutes } from '../domain/routePlan';
import type { GatewayUseCaseDeps } from './dependencies';

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
    if (!svc) return [];
    const roles = (await deps.slots.slotRoles(serviceId)) ?? { prod: 'blue' as const, preview: 'green' as const };
    const proxyName = await deps.grants.proxyNameOf(serviceId);
    const routes = planServiceRoutes({
      projectSlug: svc.projectSlug, serviceName: svc.serviceName, namespace: svc.namespace,
      prodPhysical: roles.prod, previewPhysical: roles.preview,
      hosts: { prod: deps.hosts.prodHost(svc.projectSlug), preview: deps.hosts.previewHost(svc.projectSlug), service: deps.hosts.serviceHost(svc.serviceName) },
      ...(proxyName ? { proxyName } : {}), platformApiHost: deps.hosts.platformApiHost(),
    }, names);
    await deps.applier.applyRoutes(svc.serviceName, svc.namespace, routes);
    await deps.routes.saveForService(svc.serviceName, routes);
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
      await deps.routes.saveForService(svc.serviceName, []);
    },
    listRoutes: () => deps.routes.listAll(),
  };
}
