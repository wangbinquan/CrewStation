import type { ProjectId, RouteEntry } from '@crewstation/contracts';
import { routeObjectName } from './routePlan';

/** gateway 按服务写的几种路由；换了计划（例如不再是 APIProxy）时，不在新计划里的那几种记录标「不要了」。 */
export const SERVICE_ROUTE_KINDS: readonly RouteEntry['kind'][] = ['prod', 'preview', 'service', 'internal-api'];

export interface RoutedService {
  readonly serviceId: string;
  readonly projectId: ProjectId;
  readonly serviceName: string;
  readonly namespace: string;
}

/** 一条路由的期望（RFC-025 第三期后半）：Host、可选的路径前缀、目标 Service、中间件链；子对象是它的 IngressRoute。 */
export interface RouteDeclaration {
  readonly kind: 'route';
  readonly ref: string;
  readonly projectId: ProjectId;
  readonly spec: {
    readonly children: readonly { readonly kind: 'IngressRoute'; readonly namespace: string; readonly name: string }[];
    readonly host: string;
    readonly pathPrefix?: string;
    readonly target: { readonly namespace: string; readonly service: string; readonly port: number };
    readonly middlewares: readonly string[];
  };
  readonly display: Readonly<Record<string, string>>;
}

/**
 * 一种路由的第几条记录：第一条是 `<服务 ID>/<种类>`，之后是 `~2`、`~3`……——台账不重新声明已释放的记录，
 * 同一种路由摘掉之后再出现（例如服务不再暴露 API、后来又暴露）是一条新记录。
 */
export const routeRef = (serviceId: string, kind: RouteEntry['kind'], nth = 1): string => (nth === 1 ? `${serviceId}/${kind}` : `${serviceId}/${kind}~${nth}`);

/**
 * 一条路由投影进资源台账（RFC-025 第三期后半）：一条 `route` 记录，子对象是它的 IngressRoute，
 * 期望里带 Host、路径前缀、目标与中间件链，展示字段是种类、Host、路径前缀与目标。IngressRoute 仍由 gateway 建删。
 */
export function projectRoute(service: RoutedService, route: RouteEntry, ref: string): RouteDeclaration {
  return {
    kind: 'route', ref, projectId: service.projectId,
    spec: {
      children: [{ kind: 'IngressRoute', namespace: service.namespace, name: routeObjectName(service.serviceName, route.kind) }],
      host: route.host, ...(route.pathPrefix ? { pathPrefix: route.pathPrefix } : {}), target: route.target, middlewares: route.middlewares,
    },
    display: { role: route.kind, host: route.host, ...(route.pathPrefix ? { pathPrefix: route.pathPrefix } : {}), target: `${route.target.namespace}/${route.target.service}` },
  };
}
