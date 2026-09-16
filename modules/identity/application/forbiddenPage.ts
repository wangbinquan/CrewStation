import { brandMarkDataUrl } from '../domain/brandMark';

export interface ForbiddenPageInput {
  /** ForwardAuth 判定给出的原因，原话展示。 */
  readonly message: string;
  /** 工作台首页，作为始终可用的返回路径。 */
  readonly consoleUrl: string;
}

/**
 * 用户域上被拒绝的浏览器导航（preview／dev 主机无成员或测试者角色等）：给人看的页面，而不是一段 JSON。
 * 对象与原因用服务端原话，返回路径固定指向工作台（design.md §3“无权限”）。配色与演示登录页同源，跟随系统明暗。
 */
export function renderForbiddenPage({ message, consoleUrl }: ForbiddenPageInput): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>无权访问 · CrewStation</title>
<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f7fa; color: #182438; margin: 0; padding: 24px; }
  main { max-width: 480px; margin: 8vh auto; background: #fff; border: 1px solid #dce3ed; border-radius: 12px; padding: 28px; }
  h1 { display: flex; align-items: center; gap: 10px; font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 16px 0 8px; }
  .reason { background: #fff5df; border: 1px solid #f0c36d; color: #86520a; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.6; word-break: break-all; }
  p { font-size: 14px; line-height: 1.6; color: #59677c; }
  a.back { display: inline-block; margin-top: 12px; padding: 8px 14px; border-radius: 6px; background: #235bd8; color: #fff; text-decoration: none; font-size: 14px; }
  a.back:hover { background: #1c4db8; }
  :focus-visible { outline: 2px solid #8db3ff; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    body { background: #11151c; color: #e7edf6; }
    main { background: #191f29; border-color: #344154; }
    .reason { background: #392f1c; border-color: #6b5628; color: #f4c976; }
    p { color: #adbacd; }
    a.back { background: #3970df; }
    a.back:hover { background: #4d84ee; }
  }
</style>
</head>
<body>
<main>
  <h1><img src="${brandMarkDataUrl}" alt="" width="40" height="40">CrewStation</h1>
  <h2>无权访问这个地址</h2>
  <p class="reason">${escapeHtml(message)}</p>
  <p>这不是页面不存在：你已登录，但当前账号没有访问它所需的项目角色。需要访问时请联系该项目负责人，获得成员或 preview 测试者角色后刷新即可。</p>
  <a class="back" href="${escapeHtml(consoleUrl)}">返回工作台</a>
</main>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
