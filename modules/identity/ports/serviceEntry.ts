import type { OfflineReason, UserId } from '@crewstation/contracts';

/** prod／preview 主机在放行前的入口状态（RFC-021 design §6）；由 gateway 模块经装配提供。 */
export type ServiceEntryVerdict =
  | { readonly kind: 'open' }
  /** 正式版本维护中且这个人不在放行范围：维护页。 */
  | { readonly kind: 'maintenance'; readonly projectSlug: string; readonly reason: string; readonly expectedEndAt?: string; readonly retryAfterSeconds?: number }
  /** 待命槽上没有工作负载：未部署待验证版本的说明页。 */
  | { readonly kind: 'not-deployed'; readonly projectSlug: string; readonly offline?: { readonly at: string; readonly reason: OfflineReason; readonly tag?: string } };

export interface ServiceEntry {
  check(userId: UserId, projectSlug: string, slot: 'prod' | 'preview'): Promise<ServiceEntryVerdict>;
}
