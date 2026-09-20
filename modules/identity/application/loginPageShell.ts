import { brandMarkDataUrl } from '../domain/brandMark';

/** 页面外壳：配色与 apps/console 的 tokens.css 同源，跟随系统明暗；三张登录相关页面共用它。 */
export function loginPageShell(title: string, body: string): string {
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
  main { max-width: 440px; margin: 3vh auto; background: #fff; border: 1px solid #dce3ed; border-radius: 12px; padding: 28px; }
  h1 { display: flex; align-items: center; gap: 10px; font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 15px; margin: 22px 0 8px; color: #59677c; font-weight: 600; }
  .notice { background: #fff5df; border: 1px solid #f0c36d; color: #86520a; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.6; }
  .error { background: #fdecec; border: 1px solid #eba9a9; color: #8c2020; border-radius: 8px; padding: 10px 12px; font-size: 14px; line-height: 1.6; }
  label { display: block; margin: 14px 0 4px; font-size: 14px; }
  input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #dce3ed; border-radius: 6px; font-size: 15px; background: #fff; color: inherit; }
  button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 6px; background: #235bd8; color: #fff; font-size: 15px; cursor: pointer; }
  button:hover { background: #1c4db8; }
  a.provider { display: block; margin-top: 10px; padding: 10px; border: 1px solid #235bd8; border-radius: 6px; color: #235bd8; text-decoration: none; font-size: 15px; text-align: center; }
  a.provider strong { display: block; font-weight: 600; }
  /* 名字与说明分两行：显示名常是中英混排（「Mock 公司身份」「Corp SSO」），拼进一句话里就会缺字间空格。 */
  a.provider span { display: block; margin-top: 2px; font-size: 12px; color: #59677c; }
  a.provider:hover { background: #eef3fd; }
  a.back { display: inline-block; margin-top: 16px; font-size: 14px; color: #235bd8; }
  :focus-visible { outline: 2px solid #8db3ff; outline-offset: 2px; }
  .hint { color: #59677c; font-size: 12px; line-height: 1.6; word-break: break-all; }
  .field-error { color: #8c2020; font-size: 12px; margin: 4px 0; }
  input[aria-invalid="true"] { border-color: #8c2020; }
  .field-hint { margin: 4px 0; }
  summary { cursor: pointer; }
  code { overflow-wrap: anywhere; }
  @media (max-width: 480px) { body { padding: 12px; } main { padding: 20px; margin: 0 auto; } }
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
    a.provider span { color: #adbacd; }
    a.provider:hover { background: #222b39; }
    .hint { color: #adbacd; }
    .field-error { color: #f3b0b0; }
  }
</style>
</head>
<body>
<main>
  <h1><img src="${brandMarkDataUrl}" alt="" width="40" height="40">CrewStation</h1>
  ${body}
</main>
<script>
  // 安装链接的一次性凭据只留在当前表单；已完成初始化时同样清除旧链接的令牌。
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('token')) {
    const input = document.querySelector('#token');
    const token = fragment.get('token');
    if (input && token && token.length <= 512) {
      input.value = token;
      document.querySelector('#token-fields').hidden = true;
      document.querySelector('#username').focus();
    }
    fragment.delete('token');
    history.replaceState(null, '', location.pathname + location.search + (fragment.size ? '#' + fragment : ''));
  }
</script>
</body>
</html>
`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
