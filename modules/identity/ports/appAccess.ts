import type { ProjectId, UserId } from '@crewstation/contracts';

/** 被拦下时「没有项目权限」页要写的事实：应用名、负责人名，以及给不给「申请访问权限」。 */
export interface AppAccessDenial {
  readonly projectId: ProjectId;
  readonly appName: string;
  readonly ownerName: string;
  readonly requestable: boolean;
}

/** 与 project 模块的 AppAccessVerdict 同形；`unknown` 是查不到项目或已归档。 */
export type AppAccessVerdict = { readonly kind: 'allowed' } | ({ readonly kind: 'denied' } & AppAccessDenial) | { readonly kind: 'unknown' };

/**
 * 由 project 模块经装配提供（2026-09-24 裁定）：正式地址按应用可见范围放行——管理员、任一成员角色（含「用户」），
 * 或范围是「全部登录用户」。缺省实现一律 unknown，即不配置时正式地址全部拒绝。
 */
export interface AppAccess {
  check(user: { readonly id: UserId; readonly isAdmin: boolean }, projectSlug: string): Promise<AppAccessVerdict>;
}
