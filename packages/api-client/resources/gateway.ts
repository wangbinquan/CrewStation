import type { AllowlistDocument, RouteEntry } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';

/** GET /v1/gateway/routes 的条目：一个服务及其当前路由表条目。 */
export interface GatewayServiceRoutes {
  readonly serviceName: string;
  readonly routes: RouteEntry[];
}

/** 尚未生成放行表时服务端返回 `{ version: 0, entries: [], defaultOpen: [] }`，因此后两个字段可选。 */
export type GatewayAllowlistDto = Pick<AllowlistDocument, 'version' | 'entries' | 'defaultOpen'> & Partial<Pick<AllowlistDocument, 'generatedAt' | 'maxStaleSeconds'>>;

export interface GatewayReconcileResult {
  /** 重算的路由条目数。 */
  readonly routes: number;
  /** 重建后的放行表版本。 */
  readonly allowlist: number;
}

/** 网关状态（仅管理员）：路由表、放行表与手动重算。 */
export interface GatewayResource {
  /** GET /v1/gateway/routes */
  listRoutes(): Promise<ItemsPage<GatewayServiceRoutes>>;
  /** GET /v1/gateway/allowlist */
  allowlist(): Promise<GatewayAllowlistDto>;
  /** POST /v1/gateway/reconcile */
  reconcile(): Promise<GatewayReconcileResult>;
}

export function gatewayResource(transport: Transport): GatewayResource {
  return {
    listRoutes: () => transport.request<ItemsPage<GatewayServiceRoutes>>('GET', '/v1/gateway/routes'),
    allowlist: () => transport.request<GatewayAllowlistDto>('GET', '/v1/gateway/allowlist'),
    reconcile: () => transport.request<GatewayReconcileResult>('POST', '/v1/gateway/reconcile'),
  };
}
