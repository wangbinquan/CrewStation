import type { LoginDiscoveryDto } from '@crewstation/contracts';
import { renderBootstrapPage } from './bootstrapPage';
import { escapeHtml, loginPageShell as shell } from './loginPageShell';
import type { OidcFailureCode } from '../domain/idpClaims';
import { LOGIN_PATH } from '../domain/session';

export interface LoginPageInput {
  readonly discovery: LoginDiscoveryDto;
  /** 已由用例层校验过的跳转地址。 */
  readonly returnTo: string;
  /** 上一次提交的失败原因，原话展示。 */
  readonly error?: string;
  /** 刚完成引导：交接成功后必须用新账户正常登录一次，页面要说清这一步。 */
  readonly justBootstrapped?: boolean;
}

/**
 * 登录页：方法完全由服务端的登录发现决定（RFC-005 §5）。
 * 引导未完成时只渲染引导入口；常规登录关闭后连表单都不渲染，后端另有固定 403，两侧一致。
 */
export function renderLoginPage({ discovery, returnTo, error, justBootstrapped }: LoginPageInput): string {
  if (discovery.mode === 'bootstrap') {
    return renderBootstrapPage(error, { returnTo });
  }
  const password = discovery.passwordLoginEnabled ? `
  <h2>用户名密码</h2>
  <form method="post" action="${LOGIN_PATH}">
    <label for="username">用户名</label>
    <input id="username" name="username" required autofocus autocomplete="username">
    <label for="password">密码</label>
    <input id="password" name="password" type="password" required autocomplete="current-password">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    <button type="submit">登录</button>
  </form>` : '';
  const providers = discovery.providers.length === 0 ? '' : `
  <h2>公司身份</h2>
  <nav class="provider-list" aria-label="公司身份登录方式">${discovery.providers.map((p) => `
    <a class="provider-card" href="/auth/oidc/${encodeURIComponent(p.slug)}/start?returnTo=${encodeURIComponent(returnTo)}" aria-label="使用 ${escapeHtml(p.displayName)} 登录">
      <span class="provider-card-mark" aria-hidden="true">ID</span>
      <span class="provider-card-copy"><strong>${escapeHtml(p.displayName)}</strong><span>使用公司身份继续</span></span>
      <span class="provider-card-action" aria-hidden="true">→</span>
    </a>`).join('')}
  </nav>`;
  const empty = password === '' && providers === '' ? `
  <p class="error">当前没有可用的登录方式：用户名密码登录已关闭，且没有启用的身份提供方。持有集群权限的运维可在安装配置里设置 <code>CS_PASSWORD_LOGIN=force-on</code> 并重启 cs-auth 与 cs-api 恢复。</p>` : '';
  const done = justBootstrapped === true ? '<p class="notice">首位管理员已创建，引导令牌已永久失效。请用刚创建的用户名与密码登录。</p>' : '';
  return shell('登录 · CrewStation', `${done}${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}${providers}${password}${empty}
  <p class="hint">登录后跳回 <code>${escapeHtml(returnTo)}</code>。</p>`);
}

const FAILURE_TEXT: Record<OidcFailureCode, string> = {
  'invalid-callback': '身份提供方回调缺少必要参数。请重新发起登录。',
  'state-expired': '本次登录已过期或已被使用。请回到登录页重新发起。',
  'provider-disabled': '该身份提供方已被管理员停用。',
  'client-secret-missing': '平台未能取出该身份提供方的凭据，请联系管理员。',
  'endpoints-unresolved': '无法解析该身份提供方的端点：自动发现失败且没有可用的手工端点。请联系管理员用「测试连接」核对配置。',
  'token-exchange-failed': '与身份提供方交换令牌失败。请稍后重试，或联系管理员核对 Client ID 与密钥。',
  'id-token-verify-failed': '身份提供方返回的令牌未通过验签。请联系管理员核对 JWKS 地址与签名算法。',
  'userinfo-fetch-failed': '读取身份提供方的用户信息失败。请稍后重试，或联系管理员核对 userinfo 端点与请求风格。',
  'userinfo-shape-invalid': '身份提供方返回的用户信息缺少可用的主体字段。请联系管理员核对「主体字段」配置。',
  'userinfo-unavailable': '该身份提供方没有可用的用户信息端点，无法确定你的身份。请联系管理员。',
  'jwks-unavailable': '该身份提供方既没有可用的 JWKS，也没有用户信息端点，无法确定你的身份。请联系管理员。',
  'userinfo-subject-mismatch': '用户信息与已验证的令牌不是同一个主体，登录已被拒绝。',
  'email-claim-invalid': '身份提供方返回的邮箱字段不可用。请联系管理员核对「邮箱字段」配置。',
  'display-name-claim-invalid': '身份提供方返回的显示名字段不可用。请联系管理员核对「显示名字段」配置。',
  'git-name-claim-invalid': '身份提供方返回的 Git 名字段不可用。请联系管理员核对「Git 名字段」配置。',
  'email-not-verified': '该身份提供方要求邮箱已验证才能开通账户，而这次登录没有带来已验证的邮箱。',
  'email-domain-not-allowed': '你的邮箱域名不在允许列表内，无法开通账户。请联系管理员。',
  'bootstrap-admin-required': '平台尚未创建首位管理员，公司身份登录暂不可用。',
  'provider-config-changed': '登录过程中该身份提供方的配置发生了变化，本次登录已被拒绝。请重新发起登录。',
};

/** 回调失败给人看的页面：原因确定、可自助判断下一步，而不是一段 JSON 500。 */
export function renderLoginErrorPage(code: OidcFailureCode): string {
  return shell('登录失败 · CrewStation', `
  <p class="error">${escapeHtml(FAILURE_TEXT[code])}</p>
  <p class="hint">错误码 <code>${escapeHtml(code)}</code>，管理员可据此在认证页定位配置项。</p>
  <a class="back" href="${LOGIN_PATH}">返回登录</a>`);
}
