import type { AuthMethod, LoginDiscoveryDto } from '@crewstation/contracts';
import { PLATFORM_PATHS } from '@crewstation/contracts';
import { LOGIN_PATH, LOGOUT_PATH } from './session';

/** 库内登录策略（identity.auth_login_policy 单行）。 */
export interface LoginPolicy {
  readonly passwordLoginEnabled: boolean;
  readonly bootstrapCompletedAt: Date | null;
}

export interface EnabledProvider {
  readonly slug: string;
  readonly displayName: string;
}

/** 常规登录是否真的可用：安装配置的强制开关（A7）压过库内策略，引导未完成时一律不可用。 */
export function passwordLoginUsable(policy: LoginPolicy, forcedOn: boolean): boolean {
  if (policy.bootstrapCompletedAt === null) return false;
  return forcedOn || policy.passwordLoginEnabled;
}

/** 引导令牌只在引导未完成时有效；完成态是数据库，删掉 Secret 不算退役，重建也不能复活。 */
export function bootstrapTokenUsable(policy: LoginPolicy): boolean {
  return policy.bootstrapCompletedAt === null;
}

/**
 * 登录方法发现（RFC-005 §5）。引导未完成时只回引导令牌一条路，
 * 即使库里已经预置了 Provider 也不提前暴露 OIDC 或密码入口。
 */
export function loginDiscovery(policy: LoginPolicy, providers: readonly EnabledProvider[], forcedOn: boolean): LoginDiscoveryDto {
  const paths = { loginPath: LOGIN_PATH, logoutPath: LOGOUT_PATH, jwksPath: PLATFORM_PATHS.jwks };
  if (bootstrapTokenUsable(policy)) {
    return { mode: 'bootstrap', passwordLoginEnabled: false, bootstrapTokenEnabled: true, providers: [], ...paths };
  }
  return {
    mode: 'ready',
    passwordLoginEnabled: passwordLoginUsable(policy, forcedOn),
    bootstrapTokenEnabled: false,
    providers: providers.map((p) => ({ slug: p.slug, displayName: p.displayName })),
    ...paths,
  };
}

export type DisablePasswordLoginVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'not-admin' | 'requires-oidc-session' | 'requires-enabled-oidc' | 'forced-on' };

/**
 * 关闭常规登录的三条前置（作者裁定 A2）：调用者是平台管理员、**当前会话由 OIDC 建立**、至少一个启用的 Provider。
 * 第二条是关键：只有已经证明自己能经 OIDC 进来的管理员才能关掉密码登录，
 * 因此这个动作不可能把所有人锁在门外——这正是它取代「自动失效」的原因。
 */
export function canDisablePasswordLogin(input: {
  readonly isAdmin: boolean;
  readonly authMethod: AuthMethod;
  readonly enabledProviderCount: number;
  readonly forcedOn: boolean;
}): DisablePasswordLoginVerdict {
  if (!input.isAdmin) return { allowed: false, reason: 'not-admin' };
  if (input.forcedOn) return { allowed: false, reason: 'forced-on' };
  if (input.authMethod !== 'oidc') return { allowed: false, reason: 'requires-oidc-session' };
  if (input.enabledProviderCount < 1) return { allowed: false, reason: 'requires-enabled-oidc' };
  return { allowed: true };
}

/** 密码登录关着时，最后一个启用的 Provider 不能停用或删除，否则没人能再登录。 */
export function blocksLastEnabledProvider(input: {
  readonly policy: LoginPolicy;
  readonly forcedOn: boolean;
  readonly enabledProviderCount: number;
  readonly providerWasEnabled: boolean;
}): boolean {
  if (!input.providerWasEnabled) return false;
  if (passwordLoginUsable(input.policy, input.forcedOn)) return false;
  return input.enabledProviderCount <= 1;
}
