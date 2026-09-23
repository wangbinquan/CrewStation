import type { RouteEntry } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import { LABELS, Resources, ingressRouteObject, stripPrefixMiddleware } from '@crewstation/k8s';
import { PREFIX_ROUTE_PRIORITY } from '../../domain/routeProjection';
import { routeObjectName } from '../../domain/routePlan';
import type { GatewayApplier, GatewaySettings } from '../../ports/gatewayApply';

/** 路由条目 → Traefik IngressRoute；系统中间件跨命名空间引用，前缀剥离中间件随路由建在项目命名空间。 */
export function traefikApplier(k8s: K8sClient, settings: Pick<GatewaySettings, 'systemNamespace' | 'userAuthMiddleware' | 'serviceAuthMiddleware' | 'dropIdentityHeadersMiddleware'>): GatewayApplier {
  const systemMiddlewares = new Set([settings.userAuthMiddleware, settings.serviceAuthMiddleware, settings.dropIdentityHeadersMiddleware]);
  const applyMiddlewares = async (namespace: string, entries: RouteEntry[]) => {
    for (const route of entries) {
      for (const mw of route.middlewares.filter((m) => m.startsWith('strip-api-'))) {
        await k8s.apply(stripPrefixMiddleware({ name: mw, namespace, prefixes: [route.pathPrefix ?? '/'] }));
      }
    }
  };
  return {
    applyMiddlewares,
    applyRoutes: async (serviceName, namespace, entries) => {
      await applyMiddlewares(namespace, entries);
      const wanted = new Set<string>();
      for (const route of entries) {
        const name = routeObjectName(serviceName, route.kind);
        wanted.add(name);
        await k8s.apply(ingressRouteObject({
          name, namespace, host: route.host, ...(route.pathPrefix ? { pathPrefix: route.pathPrefix, priority: PREFIX_ROUTE_PRIORITY } : {}),
          target: { name: route.target.service, port: route.target.port, namespace: route.target.namespace },
          middlewares: route.middlewares.map((m) => (systemMiddlewares.has(m) ? { name: m, namespace: settings.systemNamespace } : { name: m })),
          labels: { [LABELS.service]: serviceName, [LABELS.component]: 'route' },
        }));
      }
      const existing = await k8s.list(Resources.IngressRoute!, namespace, { labelSelector: `${LABELS.service}=${serviceName},${LABELS.component}=route` });
      for (const stale of existing.filter((o) => !wanted.has(o.metadata.name))) await k8s.delete(Resources.IngressRoute!, stale.metadata.name, namespace);
    },
    removeRoutes: async (serviceName, namespace) => {
      const existing = await k8s.list(Resources.IngressRoute!, namespace, { labelSelector: `${LABELS.service}=${serviceName},${LABELS.component}=route` });
      for (const route of existing) await k8s.delete(Resources.IngressRoute!, route.metadata.name, namespace);
    },
  };
}
