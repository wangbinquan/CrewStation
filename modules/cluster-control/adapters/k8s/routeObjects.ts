import type { K8sObject } from '@crewstation/k8s';
import { ingressRouteObject, LABELS } from '@crewstation/k8s';
import type { RouteRender } from '../../domain/routeRender';

/** 按路由期望渲染 IngressRoute：与 gateway 直接建时（traefikApplier）同一个构造函数、同样的标签。 */
export function routeObject(route: RouteRender): K8sObject {
  return ingressRouteObject({
    name: route.name, namespace: route.namespace, host: route.host,
    ...(route.pathPrefix ? { pathPrefix: route.pathPrefix } : {}), ...(route.priority ? { priority: route.priority } : {}),
    target: { name: route.target.service, port: route.target.port, namespace: route.target.namespace },
    middlewares: route.middlewares.map((entry) => ({ ...entry })), labels: { [LABELS.service]: route.service, [LABELS.component]: 'route' },
  });
}
