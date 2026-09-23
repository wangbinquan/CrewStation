import type { RouteEntry } from '@crewstation/contracts';

/** 把路由表条目落到网关（Traefik IngressRoute／Middleware）；实现在 adapters/k8s。 */
export interface GatewayApplier {
  applyRoutes(serviceName: string, namespace: string, routes: RouteEntry[]): Promise<void>;
  removeRoutes(serviceName: string, namespace: string): Promise<void>;
  /** 配了资源台账时（RFC-025 第三期后半）：IngressRoute 由调和器照路由记录应用，这里只建路由引用的前缀剥离中间件。 */
  applyMiddlewares(namespace: string, routes: RouteEntry[]): Promise<void>;
}

export interface GatewaySettings {
  readonly systemNamespace: string;
  readonly serviceDomain: string;
  readonly userAuthMiddleware: string;
  readonly serviceAuthMiddleware: string;
  readonly dropIdentityHeadersMiddleware: string;
  /** 放行表失联时按最后一版继续放行的最长秒数。 */
  readonly allowlistMaxStaleSeconds: number;
}
