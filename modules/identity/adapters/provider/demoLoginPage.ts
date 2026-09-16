import { LOGIN_PATH } from '../../domain/session';
import { brandMarkDataUrl } from '../../domain/brandMark';

export interface DemoLoginPageInput {
  /** 已由用例层校验过的跳转地址。 */
  returnTo: string;
}

/** 演示登录表单：醒目标注“演示身份”，字段与 contracts DemoLoginRequestSchema 一一对应。 */
export function renderDemoLoginPage({ returnTo }: DemoLoginPageInput): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CrewStation 演示登录</title>
<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">
<style>
  /* 配色与 apps/console 的 tokens.css 同源：浅色 bg #f5f7fa ／ text #182438 ／ line #dce3ed ／ action #235bd8，暗色 bg #11151c ／ surface #191f29 ／ text #e7edf6，随系统明暗切换。 */
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f7fa; color: #182438; margin: 0; padding: 24px; }
  main { max-width: 420px; margin: 8vh auto; background: #fff; border: 1px solid #dce3ed; border-radius: 12px; padding: 28px; }
  h1 { display: flex; align-items: center; gap: 10px; font-size: 20px; margin: 0 0 12px; }
  .notice { background: #fff5df; border: 1px solid #f0c36d; color: #86520a; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.5; }
  label { display: block; margin: 14px 0 4px; font-size: 14px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #dce3ed; border-radius: 6px; font-size: 15px; background: #fff; color: inherit; }
  button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 6px; background: #235bd8; color: #fff; font-size: 15px; cursor: pointer; }
  button:hover { background: #1c4db8; }
  :focus-visible { outline: 2px solid #8db3ff; outline-offset: 2px; }
  .hint { color: #59677c; font-size: 12px; line-height: 1.6; word-break: break-all; }
  @media (prefers-color-scheme: dark) {
    body { background: #11151c; color: #e7edf6; }
    main { background: #191f29; border-color: #344154; }
    .notice { background: #392f1c; border-color: #6b5628; color: #f4c976; }
    input { background: #222b39; border-color: #344154; }
    button { background: #3970df; }
    button:hover { background: #4d84ee; }
    .hint { color: #adbacd; }
  }
</style>
</head>
<body>
<main>
  <h1><img src="${brandMarkDataUrl}" alt="" width="40" height="40">CrewStation</h1>
  <p class="notice"><strong>演示身份</strong>：此登录方式仅用于本地演示与开发，不接入企业账号；以此身份创建的内容在工作台里都会标注为演示身份。</p>
  <form method="post" action="${LOGIN_PATH}">
    <label for="username">用户名</label>
    <input id="username" name="username" required autofocus autocomplete="username" pattern="[a-z][a-z0-9-]{1,30}" placeholder="alice">
    <label for="displayName">显示名（可选）</label>
    <input id="displayName" name="displayName" maxlength="80" autocomplete="name" placeholder="Alice">
    <label for="email">邮箱（可选，用于管理员判定）</label>
    <input id="email" name="email" type="email" autocomplete="email" placeholder="alice@example.com">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    <button type="submit">以演示身份登录</button>
  </form>
  <p class="hint">用户名须以小写字母开头，只含小写字母、数字与连字符，2–31 位；登录后跳回 <code>${escapeHtml(returnTo)}</code>。</p>
</main>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
