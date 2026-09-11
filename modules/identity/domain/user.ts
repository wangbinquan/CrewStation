import type { UserId } from '@crewstation/contracts';

export interface User {
  readonly id: UserId;
  readonly externalId: string;
  readonly name: string;
  readonly email: string;
  readonly isAdmin: boolean;
  readonly createdAt: Date;
  readonly lastLoginAt: Date;
}

/** 管理员判定：安装配置列出的邮箱，或数据库里还没有任何用户时的第一个登录者。 */
export function shouldBootstrapAdmin(email: string, adminEmails: readonly string[], existingUsers: number): boolean {
  return adminEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase()) || existingUsers === 0;
}
