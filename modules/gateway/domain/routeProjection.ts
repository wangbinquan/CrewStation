import type { ProjectId, RouteEntry } from '@crewstation/contracts';
import { routeObjectName, STRIP_MIDDLEWARE_PREFIX } from './routePlan';

/** gateway 按服务写的几种路由；换了计划（例如不再是 APIProxy）时，不在新计划里的那几种记录标「不要了」。 */
export const SERVICE_ROUTE_KINDS: readonly RouteEntry['kind'][] = ['prod', 'preview', 'service', 'internal-api'];

export interface RoutedService {
  readonly serviceId: string;
  readonly projectId: ProjectId;
  readonly serviceName: string;
  readonly namespace: string;
}

/**
 * 一条路由的期望（RFC-025 第三期后半）：Host、可选的路径前缀、目标 Service、中间件链；子对象是它的 IngressRoute，
 * 内部 API 前缀路由另有它独用的前缀剥离中间件（T14 入账：gateway 照旧建它，路由记录「不要了」时调和器随之删掉）。
 * 调和器照它渲染 IngressRoute（cluster-control 的 routeRender），所以写全：所属服务名、前缀路由的优先级、中间件的命名空间。
 */
export interface RouteDeclaration {
  readonly kind: 'route';
  readonly ref: string;
  readonly projectId: ProjectId;
  readonly spec: {
    readonly children: readonly { readonly kind: 'IngressRoute' | 'Middleware'; readonly namespace: string; readonly name: string }[];
    /** 所属服务名（IngressRoute 的服务标签）。 */
    readonly service: string;
    readonly host: string;
    readonly pathPrefix?: string;
    readonly priority?: number;
    readonly target: { readonly namespace: string; readonly service: string; readonly port: number };
    /** 中间件链（按顺序）；平台的系统中间件带系统命名空间，跨命名空间引用。 */
    readonly middlewares: readonly { readonly name: string; readonly namespace?: string }[];
    /** 待验证与正式主机（D13）：槽「已结束」时调和器改指说明页用的中间件名（同命名空间，它也是这条记录的子对象）。 */
    readonly unavailableMiddleware?: string;
  };
  readonly display: Readonly<Record<string, string>>;
}

/** 给说明页的路由种类（D13）：待验证主机与首次上线前的正式主机；服务域与内部 API 路由照旧指向槽。 */
const EXPLAINED_KINDS: ReadonlySet<RouteEntry['kind']> = new Set(['prod', 'preview']);

/** 说明页的中间件：`unavailable-<IngressRoute 名>`，建在服务自己的命名空间，只有这一条路由引用。 */
export const unavailableMiddlewareName = (serviceName: string, kind: RouteEntry['kind']): string => `unavailable-${routeObjectName(serviceName, kind)}`;

/** 带路径前缀的路由（`/api/<proxy>`）排在同 Host 的整站路由之前。 */
export const PREFIX_ROUTE_PRIORITY = 100;

/** 平台的系统中间件（去身份头、两种 ForwardAuth）：名字与所在的系统命名空间。 */
export interface SystemMiddlewares {
  readonly names: ReadonlySet<string>;
  readonly namespace: string;
}

/**
 * 一种路由的第几条记录：第一条是 `<服务 ID>/<种类>`，之后是 `~2`、`~3`……——台账不重新声明已释放的记录，
 * 同一种路由摘掉之后再出现（例如服务不再暴露 API、后来又暴露）是一条新记录。
 */
export const routeRef = (serviceId: string, kind: RouteEntry['kind'], nth = 1): string => (nth === 1 ? `${serviceId}/${kind}` : `${serviceId}/${kind}~${nth}`);

/**
 * 一条路由投影进资源台账（RFC-025 第三期后半）：一条 `route` 记录，子对象是它的 IngressRoute，
 * 期望里带 Host、路径前缀、目标与中间件链，展示字段是种类、Host、路径前缀与目标。调和器照期望应用 IngressRoute。
 */
export function projectRoute(service: RoutedService, route: RouteEntry, ref: string, system: SystemMiddlewares): RouteDeclaration {
  const unavailable = EXPLAINED_KINDS.has(route.kind) ? unavailableMiddlewareName(service.serviceName, route.kind) : undefined;
  return {
    kind: 'route', ref, projectId: service.projectId,
    spec: {
      children: [
        { kind: 'IngressRoute', namespace: service.namespace, name: routeObjectName(service.serviceName, route.kind) },
        ...route.middlewares.filter((name) => name.startsWith(STRIP_MIDDLEWARE_PREFIX)).map((name) => ({ kind: 'Middleware' as const, namespace: service.namespace, name })),
        ...(unavailable ? [{ kind: 'Middleware' as const, namespace: service.namespace, name: unavailable }] : []),
      ],
      service: service.serviceName, host: route.host, ...(route.pathPrefix ? { pathPrefix: route.pathPrefix, priority: PREFIX_ROUTE_PRIORITY } : {}), target: route.target,
      middlewares: route.middlewares.map((name) => (system.names.has(name) ? { name, namespace: system.namespace } : { name })),
      ...(unavailable ? { unavailableMiddleware: unavailable } : {}),
    },
    display: { role: route.kind, host: route.host, ...(route.pathPrefix ? { pathPrefix: route.pathPrefix } : {}), target: `${route.target.namespace}/${route.target.service}` },
  };
}
