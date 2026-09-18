import type { UserId } from '@crewstation/contracts';

export interface User {
  readonly id: UserId;
  readonly externalId: string;
  /** 本地密码账户的登录名；OIDC 建档的行由主体派生。 */
  readonly username: string | null;
  readonly name: string;
  readonly email: string;
  /** Git 提交名；为空即跟随显示名。 */
  readonly gitName: string | null;
  /** argon2id 哈希；为空即没有本地口令，不能用常规登录进来。 */
  readonly passwordHash: string | null;
  readonly isAdmin: boolean;
  readonly createdAt: Date;
  readonly lastLoginAt: Date;
}

/** 管理员判定：安装配置列出的邮箱，或数据库里还没有任何用户时的第一个登录者。 */
export function shouldBootstrapAdmin(email: string, adminEmails: readonly string[], existingUsers: number): boolean {
  return adminEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase()) || existingUsers === 0;
}

/** 演示身份适配器登记的外部标识前缀；工作台据此把用户标注为“演示身份”。 */
export const DEMO_EXTERNAL_ID_PREFIX = 'demo:';

export function isDemoIdentity(externalId: string): boolean {
  return externalId.startsWith(DEMO_EXTERNAL_ID_PREFIX);
}

/** 外部标识的 OIDC 形态：`oidc:<providerId>:<subject>`，与 user_identities 的唯一键一一对应。 */
export function oidcExternalId(providerId: string, subject: string): string {
  return `oidc:${providerId}:${subject}`;
}

/**
 * OIDC 建档时的登录名候选：从展示名、邮箱或主体派生一个合法的小写名，再由用例层按占用情况取第一个空位。
 * 登录名对 OIDC 账户没有认证作用（它们没有口令），只是目录里一个可读的稳定标识。
 */
export function usernameCandidates(seed: { readonly preferredUsername: string | null; readonly email: string | null; readonly subject: string }): string[] {
  const base = (seed.preferredUsername ?? seed.email?.split('@')[0] ?? `oidc-${seed.subject}`)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, 40);
  const head = base.length >= 3 ? base : `oidc-${base}`.slice(0, 40);
  return [head, ...Array.from({ length: 9 }, (_, i) => `${head}-${i + 1}`)];
}
