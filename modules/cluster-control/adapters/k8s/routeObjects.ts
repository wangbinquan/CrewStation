import type { K8sObject } from '@crewstation/k8s';
import { ingressRouteObject, LABELS } from '@crewstation/k8s';
import type { ObservedObject } from '../../domain/observation';
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

/** 期望里的每个字段在观测到的对象里都相同；API Server 补上的缺省字段不算不一致，数组按位置逐个比、长度要相等。 */
export function covers(live: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) return Array.isArray(live) && live.length === desired.length && desired.every((item, index) => covers(live[index], item));
  if (typeof desired === 'object' && desired !== null) {
    return typeof live === 'object' && live !== null && Object.entries(desired).every(([field, value]) => covers((live as Record<string, unknown>)[field], value));
  }
  return live === desired;
}

/** 观测到的 IngressRoute 已经是期望的样子：标签与 spec 都覆盖期望。 */
export function routeCovered(current: ObservedObject | undefined, desired: K8sObject): boolean {
  return current !== undefined && covers(current.metadata.labels ?? {}, desired.metadata.labels ?? {}) && covers(current.spec, (desired as { spec?: unknown }).spec);
}
