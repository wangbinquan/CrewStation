import type { LoginDiscoveryDto } from '@crewstation/contracts';
import { brandMarkDataUrl } from '../domain/brandMark';
import type { OidcFailureCode } from '../domain/idpClaims';
import { LOGIN_PATH } from '../domain/session';

/** 页面外壳：配色与 apps/console 的 tokens.css 同源，跟随系统明暗；三张登录相关页面共用它。 */
function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f7fa; color: #182438; margin: 0; padding: 24px; }
  main { max-width: 440px; margin: 8vh auto; background: #fff; border: 1px solid #dce3ed; border-radius: 12px; padding: 28px; }
  h1 { display: flex; align-items: center; gap: 10px; font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 15px; margin: 22px 0 8px; color: #59677c; font-weight: 600; }
  .notice { background: #fff5df; border: 1px solid #f0c36d; color: #86520a; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.6; }
  .error { background: #fdecec; border: 1px solid #eba9a9; color: #8c2020; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.6; }
  label { display: block; margin: 14px 0 4px; font-size: 14px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #dce3ed; border-radius: 6px; font-size: 15px; background: #fff; color: inherit; }
  button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 6px; background: #235bd8; color: #fff; font-size: 15px; cursor: pointer; }
  button:hover { background: #1c4db8; }
  a.provider { display: block; margin-top: 10px; padding: 10px; border: 1px solid #235bd8; border-radius: 6px; color: #235bd8; text-decoration: none; font-size: 15px; text-align: center; }
  a.provider:hover { background: #eef3fd; }
  a.back { display: inline-block; margin-top: 16px; font-size: 14px; color: #235bd8; }
  :focus-visible { outline: 2px solid #8db3ff; outline-offset: 2px; }
  .hint { color: #59677c; font-size: 12px; line-height: 1.6; word-break: break-all; }
  @media (prefers-color-scheme: dark) {
    body { background: #11151c; color: #e7edf6; }
    main { background: #191f29; border-color: #344154; }
    h2 { color: #adbacd; }
    .notice { background: #392f1c; border-color: #6b5628; color: #f4c976; }
    .error { background: #3a2222; border-color: #7a3a3a; color: #f3b0b0; }
    input { background: #222b39; border-color: #344154; }
    button { background: #3970df; }
    button:hover { background: #4d84ee; }
    a.provider { border-color: #3970df; color: #9dbcff; }
    a.provider:hover { background: #222b39; }
    .hint { color: #adbacd; }
  }
</style>
</head>
<body>
<main>
  <h1><img src="${brandMarkDataUrl}" alt="" width="40" height="40">CrewStation</h1>
  ${body}
</main>
</body>
</html>
`;
}

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
    return shell('登录 · CrewStation', `
  <p class="notice"><strong>尚未创建管理员</strong>：全新安装只能用安装输出里的引导令牌创建首位管理员，创建完成后该令牌永久失效。</p>
  <a class="provider" href="/auth/bootstrap">创建首位管理员</a>
  <p class="hint">引导令牌在安装输出与 <code>cs-bootstrap</code> Secret 里各有一份；它只能用来创建首位管理员，不能登录。</p>`);
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
  <h2>公司身份</h2>${discovery.providers.map((p) => `
  <a class="provider" href="/auth/oidc/${encodeURIComponent(p.slug)}/start?returnTo=${encodeURIComponent(returnTo)}">使用${escapeHtml(p.displayName)}登录</a>`).join('')}`;
  const empty = password === '' && providers === '' ? `
  <p class="error">当前没有可用的登录方式：用户名密码登录已关闭，且没有启用的身份提供方。持有集群权限的运维可在安装配置里设置 <code>CS_PASSWORD_LOGIN=force-on</code> 并重启 cs-auth 恢复。</p>` : '';
  const done = justBootstrapped === true ? '<p class="notice">首位管理员已创建，引导令牌已永久失效。请用刚创建的用户名与密码登录。</p>' : '';
  return shell('登录 · CrewStation', `${done}${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}${providers}${password}${empty}
  <p class="hint">登录后跳回 <code>${escapeHtml(returnTo)}</code>。</p>`);
}

/** 引导页：唯一能用引导令牌的地方。 */
export function renderBootstrapPage(error?: string): string {
  return shell('创建首位管理员 · CrewStation', `
  <p class="notice">创建首位管理员后，引导令牌<strong>永久失效</strong>，此后只能用这个账户的用户名密码登录，或由它配置公司身份登录。</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="/auth/bootstrap">
    <label for="token">引导令牌</label>
    <input id="token" name="token" required autofocus autocomplete="off">
    <label for="username">用户名</label>
    <input id="username" name="username" required pattern="[a-z][a-z0-9_-]{2,47}" autocomplete="username">
    <label for="displayName">显示名</label>
    <input id="displayName" name="displayName" required maxlength="80" autocomplete="name">
    <label for="email">邮箱</label>
    <input id="email" name="email" type="email" required autocomplete="email">
    <label for="password">密码（至少 12 位）</label>
    <input id="password" name="password" type="password" required minlength="12" autocomplete="new-password">
    <label for="confirmPassword">再次输入密码</label>
    <input id="confirmPassword" name="confirmPassword" type="password" required minlength="12" autocomplete="new-password">
    <button type="submit">创建管理员</button>
  </form>
  <a class="back" href="${LOGIN_PATH}">返回登录</a>`);
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
