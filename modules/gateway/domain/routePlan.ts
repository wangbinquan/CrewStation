import type { RouteEntry } from '@crewstation/contracts';
import { PROJECT_MIDDLEWARES } from './rateLimitProjection';

export interface ServiceRoutingInput {
  projectSlug: string;
  serviceName: string;
  namespace: string;
  prodPhysical: 'blue' | 'green';
  previewPhysical: 'blue' | 'green';
  hosts: { prod: string; preview: string; service: string };
  /** 若该服务是 APIProxy 或暴露了 API，其目录中的 proxy 名；平台 API 主机上的 `/api/<proxy>/` 前缀路由到它。 */
  proxyName?: string;
  platformApiHost: string;
}

export interface GatewayNames {
  systemNamespace: string;
  userAuthMiddleware: string;
  serviceAuthMiddleware: string;
  dropIdentityHeadersMiddleware: string;
  /**
   * 挂限流（RFC-025 T10）：用户域在 ForwardAuth 之后按用户、按主机，服务域按来源服务、按目标。中间件由资源台账里的限流记录渲染，
   * 所以只在配了资源台账时挂；没配时（gateway 直接建路由）不挂。
   */
  rateLimits?: boolean;
}

const slotService = (input: ServiceRoutingInput, physical: string): RouteEntry['target'] => ({ namespace: input.namespace, service: `${input.serviceName}-${physical}`, port: 80 });

/** 一个服务的全部路由：用户域的 prod／preview 主机、服务域的服务主机、可选的内部 API 前缀。切流只改 prod／preview 指向的物理槽。 */
export function planServiceRoutes(input: ServiceRoutingInput, names: GatewayNames): RouteEntry[] {
  const userLimits = names.rateLimits ? [PROJECT_MIDDLEWARES.user, PROJECT_MIDDLEWARES.host] : [];
  const serviceLimits = names.rateLimits ? [PROJECT_MIDDLEWARES.source, PROJECT_MIDDLEWARES.target] : [];
  const userMw = [names.dropIdentityHeadersMiddleware, names.userAuthMiddleware, ...userLimits];
  const serviceMw = [names.dropIdentityHeadersMiddleware, names.serviceAuthMiddleware, ...serviceLimits];
  const routes: RouteEntry[] = [
    { host: input.hosts.prod, domain: 'user', kind: 'prod', target: slotService(input, input.prodPhysical), middlewares: userMw },
    { host: input.hosts.preview, domain: 'user', kind: 'preview', target: slotService(input, input.previewPhysical), middlewares: userMw },
    { host: input.hosts.service, domain: 'service', kind: 'service', target: slotService(input, input.prodPhysical), middlewares: serviceMw },
  ];
  if (input.proxyName) {
    routes.push({ host: input.platformApiHost, pathPrefix: `/api/${input.proxyName}`, domain: 'service', kind: 'internal-api', target: slotService(input, input.prodPhysical), middlewares: [...serviceMw, `strip-api-${input.proxyName}`] });
  }
  return routes;
}

/** Kubernetes 对象名：稳定、可预测，重复 apply 幂等。 */
export function routeObjectName(serviceName: string, kind: RouteEntry['kind']): string {
  return `${serviceName}-${kind}`;
}
