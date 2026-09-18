import type { ProvisioningPolicy } from '@crewstation/contracts';
import type { IdpClaims, OidcFailureCode } from './idpClaims';

export type ProvisioningDecision =
  | { readonly action: 'login'; readonly userId: string }
  | { readonly action: 'create' }
  | { readonly action: 'reject'; readonly reason: Extract<OidcFailureCode, 'email-not-verified' | 'email-domain-not-allowed'> };

export interface ProvisioningConfig {
  readonly provisioning: ProvisioningPolicy;
  readonly allowedEmailDomains: readonly string[];
}

/**
 * 开通决策（RFC-005 §7）。纯函数，把六条分支从回调里拿出来单独锁住：
 *   已有该 Provider 的身份            → 登录
 *   auto                              → 建档（不查邮箱）
 *   allowlist ＋ 邮箱已验证且域名命中 → 建档
 *   allowlist ＋ 邮箱未验证           → 拒绝 email-not-verified
 *   allowlist ＋ 域名不命中           → 拒绝 email-domain-not-allowed
 * 没有 invite 一档：本仓按作者裁定 A3 不做。
 */
export function decideProvisioning(
  config: ProvisioningConfig,
  claims: Pick<IdpClaims, 'email' | 'emailVerified'>,
  existingIdentityUserId: string | null,
): ProvisioningDecision {
  if (existingIdentityUserId !== null) return { action: 'login', userId: existingIdentityUserId };
  if (config.provisioning === 'auto') return { action: 'create' };
  const email = claims.email?.toLowerCase() ?? null;
  if (email === null || !claims.emailVerified) return { action: 'reject', reason: 'email-not-verified' };
  const allowed = config.allowedEmailDomains.some((domain) => email.endsWith(domain.toLowerCase()));
  return allowed ? { action: 'create' } : { action: 'reject', reason: 'email-domain-not-allowed' };
}
