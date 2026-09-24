import type { AppVisibilityMode, ManifestKind, MemberRole } from '@crewstation/contracts';

/** 判定正式地址使用权要的全部事实；由一次联查取出（adapters/persistence/drizzleAppListings.ts 的 `accessFacts`）。 */
export interface AppAccessFacts {
  readonly kind: ManifestKind;
  readonly ownerIsUser: boolean;
  readonly role: MemberRole | undefined;
  readonly mode: AppVisibilityMode;
  readonly allowRequests: boolean;
}

/**
 * 正式地址的使用权（2026-09-24 裁定，RFC-003 §3 修订）：管理员、负责人与任一成员角色（含「用户」）放行；
 * 数字人的范围是「全部登录用户」时人人放行。接入容器不进市场、没有可见范围，只给管理员与成员。
 */
export function canUseApp(facts: AppAccessFacts, isAdmin: boolean): boolean {
  if (isAdmin || facts.ownerIsUser || facts.role !== undefined) return true;
  return facts.kind === 'DigitalWorker' && facts.mode === 'authenticated';
}

/** 无权限页给不给「申请访问权限」：只有数字人、且负责人允许申请时给；接入容器只写「请联系项目负责人」。 */
export function acceptsRequests(facts: Pick<AppAccessFacts, 'kind' | 'allowRequests'>): boolean {
  return facts.kind === 'DigitalWorker' && facts.allowRequests;
}
