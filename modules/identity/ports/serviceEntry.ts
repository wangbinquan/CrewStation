import type { OfflineReason, UserId } from '@crewstation/contracts';

/**
 * prod／preview 主机在放行前的入口状态（RFC-021 design §6）；由 gateway 模块经装配提供。待命槽上没有版本不在这里判——
 * 槽「已结束」时路由改指说明页（RFC-025 D13、I26 裁定）。
 */
export type ServiceEntryVerdict =
  | { readonly kind: 'open' }
  /** 正式版本维护中且这个人不在放行范围：维护页。 */
  | { readonly kind: 'maintenance'; readonly projectSlug: string; readonly reason: string; readonly expectedEndAt?: string; readonly retryAfterSeconds?: number };

/** 两张 503 页的内容：维护页，与说明页（待验证或正式主机此刻没有在运行的版本；正式主机即尚未上线，recovering 是刚部署好、路由还没改回来）。 */
export type UnavailablePageEntry =
  | Extract<ServiceEntryVerdict, { kind: 'maintenance' }>
  | { readonly kind: 'not-deployed'; readonly projectSlug: string; readonly slot?: 'prod' | 'preview'; readonly recovering?: true; readonly offline?: { readonly at: string; readonly reason: OfflineReason; readonly tag?: string } };

export interface ServiceEntry {
  check(userId: UserId, projectSlug: string, slot: 'prod' | 'preview'): Promise<ServiceEntryVerdict>;
}
