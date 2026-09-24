import { brandMarkDataUrl } from '../domain/brandMark';

export interface ForbiddenPageInput {
  /** ForwardAuth 判定给出的原因，原话展示。 */
  readonly message: string;
  /** 工作台首页，作为始终可用的返回路径。 */
  readonly consoleUrl: string;
}

export interface NoAppAccessPageInput {
  readonly appName: string;
  readonly ownerName: string;
  /** 负责人允许申请时给出：工作台里这个应用的申请页地址。 */
  readonly applyUrl?: string;
  readonly consoleUrl: string;
}

/**
 * 用户域上被拒绝的浏览器导航（preview／dev 主机无成员或测试者角色等）：给人看的页面，而不是一段 JSON。
 * 对象与原因用服务端原话，返回路径固定指向工作台（design.md §3“无权限”）。配色与登录页同源，跟随系统明暗。
 */
export function renderForbiddenPage({ message, consoleUrl }: ForbiddenPageInput): string {
  return page('无权访问', `
  <h2>无权访问这个地址</h2>
  <p class="reason">${escapeHtml(message)}</p>
  <p>这不是页面不存在：你已登录，但当前账号没有访问它所需的项目角色。需要访问时请联系该项目负责人，获得成员或 preview 测试者角色后刷新即可。</p>
  <div class="actions"><a class="button primary" href="${escapeHtml(consoleUrl)}">返回工作台</a></div>`);
}

/**
 * 正式地址按应用可见范围拦下时，平台统一的「没有项目权限」页（2026-09-24 裁定）。负责人允许申请时给「申请访问权限」，
 * 新开工作台的申请页，原页留着，批准后刷新即可；不允许时只写「请联系项目负责人」和负责人的名字。
 */
export function renderNoAppAccessPage({ appName, ownerName, applyUrl, consoleUrl }: NoAppAccessPageInput): string {
  const next = applyUrl
    ? `<p>可以向负责人申请，批准后刷新本页即可。</p>
  <div class="actions"><a class="button primary" href="${escapeHtml(applyUrl)}" target="_blank" rel="noopener">申请访问权限</a><a class="button" href="${escapeHtml(consoleUrl)}">返回工作台</a></div>`
    : `<p>请联系项目负责人：<strong>${escapeHtml(ownerName)}</strong></p>
  <div class="actions"><a class="button primary" href="${escapeHtml(consoleUrl)}">返回工作台</a></div>`;
  return page('没有项目权限', `
  <h2>没有项目权限</h2>
  <p class="reason">你没有应用「${escapeHtml(appName)}」的使用权限</p>
  ${next}`);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · CrewStation</title>
<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f7fa; color: #182438; margin: 0; padding: 24px; }
  main { max-width: 480px; margin: 8vh auto; background: #fff; border: 1px solid #dce3ed; border-radius: 12px; padding: 28px; }
  h1 { display: flex; align-items: center; gap: 10px; font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 16px 0 8px; }
  .reason { background: #fff5df; border: 1px solid #f0c36d; color: #86520a; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.6; word-break: break-all; }
  p { font-size: 14px; line-height: 1.6; color: #59677c; }
  p strong { color: #182438; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  a.button { display: inline-block; padding: 8px 14px; border-radius: 6px; border: 1px solid #b7c3d4; background: #fff; color: #182438; text-decoration: none; font-size: 14px; }
  a.button:hover { background: #eef2f7; }
  a.button.primary { background: #235bd8; border-color: #235bd8; color: #fff; }
  a.button.primary:hover { background: #1c4db8; }
  :focus-visible { outline: 2px solid #8db3ff; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    body { background: #11151c; color: #e7edf6; }
    main { background: #191f29; border-color: #344154; }
    .reason { background: #392f1c; border-color: #6b5628; color: #f4c976; }
    p { color: #adbacd; }
    p strong { color: #e7edf6; }
    a.button { background: #191f29; border-color: #4a5a70; color: #e7edf6; }
    a.button:hover { background: #232b38; }
    a.button.primary { background: #3970df; border-color: #3970df; color: #fff; }
    a.button.primary:hover { background: #4d84ee; }
  }
</style>
</head>
<body>
<main>
  <h1><img src="${brandMarkDataUrl}" alt="" width="40" height="40">CrewStation</h1>${body}
</main>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
