import type { RouteDeclaration } from '../domain/routeProjection';

/** 资源中心（RFC-025）的写入口：gateway 写路由的期望，实况由资源中心写。由组合根接到 resources 模块。 */
export interface RouteLedger {
  declare(input: RouteDeclaration): Promise<{ readonly id: string }>;
  find(ref: string, kind: 'route'): Promise<{ readonly id: string; readonly desired: 'present' | 'absent' } | undefined>;
  requestRelease(id: string, reason: { readonly code: string; readonly message: string }): Promise<unknown>;
}
