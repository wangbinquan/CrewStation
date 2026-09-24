import type { RateLimitDeclaration } from '../domain/rateLimitProjection';
import type { RouteDeclaration } from '../domain/routeProjection';

/** 资源中心（RFC-025）的写入口：gateway 写路由的期望，实况由资源中心写。由组合根接到 resources 模块。 */
export interface RouteLedger {
  declare(input: RouteDeclaration | RateLimitDeclaration): Promise<{ readonly id: string }>;
  find(ref: string, kind: 'route' | 'rate-limit-policy'): Promise<{ readonly id: string; readonly desired: 'present' | 'absent' } | undefined>;
  requestRelease(id: string, reason: { readonly code: string; readonly message: string }): Promise<unknown>;
  /** gateway 自己的领域条件（放行表核对的 AllowlistDrift）；同样的条件台账不写库。 */
  report(id: string, report: { readonly conditions: readonly { readonly type: string; readonly status: 'true' | 'false'; readonly reason?: string; readonly message?: string }[] }): Promise<unknown>;
}

/** 说明页读到的一条台账记录（资源中心的标准字段里用得到的那几项）。 */
export interface LedgerRecordRead {
  readonly id: string;
  readonly kind: string;
  readonly owner: { readonly module: string; readonly ref: string };
  readonly desired: 'present' | 'absent';
  readonly phase: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly { readonly type: string; readonly status: string; readonly reason?: string; readonly message?: string; readonly since: string }[];
}

/** 说明页读台账（RFC-025 设计 §7.2）：路由记录，与它目标 Service 所属的槽记录。由组合根接到 resources 模块。 */
export interface LedgerReader {
  get(id: string): Promise<LedgerRecordRead | undefined>;
  claimOf(child: { readonly kind: string; readonly namespace?: string; readonly name: string }): Promise<string | undefined>;
}
