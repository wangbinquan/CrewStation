import { DEV_ROLES } from './roles';

export interface DevAuthProject {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: string;
}

export interface DevAuthPageState {
  readonly status: 'pending' | 'ready' | 'error';
  readonly startedAt: number;
  readonly projects: readonly DevAuthProject[];
  readonly error?: string;
  readonly notice?: string;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] as string);

const roleMark = (key: string): string => key === 'admin' ? 'A' : key === 'developer' ? '&gt;_' : key === 'tester' ? '✓' : '○';

function roleTag(role: (typeof DEV_ROLES)[number]): string {
  return role.isAdmin ? '全局管理权限' : role.memberRole === null ? '无项目权限' : role.memberRole === 'developer' ? '项目开发权限' : '版本试用权限';
}

function projectOptions(projects: readonly DevAuthProject[]): string {
  if (projects.length === 0) return '<option value="">当前没有可选项目</option>';
  return projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)} · ${escapeHtml(project.slug)} · ${escapeHtml(project.kind)}</option>`).join('');
}

function roleCards(state: DevAuthPageState, actionToken: string): string {
  return DEV_ROLES.map((role) => {
    const needsProject = role.key === 'tester';
    const disabled = state.status !== 'ready' || (needsProject && state.projects.length === 0);
    const returnTo = '/';
    return `<form class="role-card role-${role.key}" method="post" action="/login/${role.key}">
      <input type="hidden" name="csrf" value="${escapeHtml(actionToken)}">
      <input class="project-id" type="hidden" name="projectId" value="${escapeHtml(state.projects[0]?.id ?? '')}">
      <input type="hidden" name="returnTo" value="${returnTo}">
      <div class="role-mark" aria-hidden="true">${roleMark(role.key)}</div>
      <div class="role-copy"><span class="role-tag">${roleTag(role)}</span><h2>${role.title}</h2><p>${role.summary}</p></div>
      <button data-testid="login-${role.key}"${disabled ? ' disabled' : ''} type="submit">${disabled && state.status === 'pending' ? '准备中' : '切换登录'}<span>→</span></button>
    </form>`;
  }).join('');
}

function statusBanner(state: DevAuthPageState, actionToken: string): string {
  if (state.status === 'ready') return `<div class="status ready"><b>已就绪</b><span>角色账户和项目清单已准备</span><form method="post" action="/reseed"><input type="hidden" name="csrf" value="${escapeHtml(actionToken)}"><button type="submit">同步项目</button></form></div>`;
  if (state.status === 'error') return `<div class="status error"><b>准备失败</b><span>${escapeHtml(state.error ?? '未知错误')}</span><form method="post" action="/reseed"><input type="hidden" name="csrf" value="${escapeHtml(actionToken)}"><button type="submit">重新准备</button></form></div>`;
  return '<div class="status pending"><b>正在准备</b><span>正在连接 CrewStation 并创建开发角色…</span></div>';
}

export function renderDevAuthPage(state: DevAuthPageState, actionToken = ''): string {
  const refresh = state.status === 'pending' ? '<meta http-equiv="refresh" content="2">' : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}
  <title>开发角色登录 · CrewStation</title><style>${STYLES}</style></head><body>
  <main><header><div class="brand"><span class="logo">CS</span><div><small>CREWSTATION · LOCAL DEV</small><h1>以真实权限视角验收</h1></div></div><a href="http://console.cs.localhost/">打开控制台 ↗</a></header>
  <section class="notice"><strong>仅限本机开发环境</strong><span>每次切换都会通过 OAuth 2.0 / OIDC 建立真实会话，并把固定测试账号收敛到所选角色。</span></section>
  ${state.notice ? `<section class="action-notice" role="alert"><strong>页面已更新</strong><span>${escapeHtml(state.notice)}</span></section>` : ''}
  ${statusBanner(state, actionToken)}
  <section class="project"><label for="project">目标项目</label><select id="project"${state.projects.length === 0 ? ' disabled' : ''}>${projectOptions(state.projects)}</select><span>开发者和测试者只加入这个项目；切换普通成员会清除其项目关系。</span></section>
  <section class="roles">${roleCards(state, actionToken)}</section>
  <footer><span>Provider <code>dev-roles</code></span><span>启动于 ${new Date(state.startedAt).toLocaleString('zh-CN')}</span></footer></main>
  <script>if(location.pathname!=='/')history.replaceState(null,'','/');const select=document.querySelector('#project');const sync=()=>{if(!select)return;document.querySelectorAll('.project-id').forEach((node)=>node.value=select.value)};if(select){const saved=localStorage.getItem('crewstation.devAuth.project');if(saved&&[...select.options].some((option)=>option.value===saved))select.value=saved;sync();select.addEventListener('change',()=>{localStorage.setItem('crewstation.devAuth.project',select.value);sync()})}</script>
  </body></html>`;
}

/** OAuth Provider 没预选角色时的真实选择页：GET 表单保留整套 OIDC 参数，整卡按钮继续授权。 */
export function renderOidcRoleChoicePage(url: URL): string {
  const hidden = [...url.searchParams.entries()]
    .filter(([name]) => name !== 'as')
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
  const cards = DEV_ROLES.map((role) => `<form class="oidc-role-option role-${role.key}" method="get" action="${escapeHtml(url.pathname)}">
    ${hidden}<input type="hidden" name="as" value="${escapeHtml(role.sub)}">
    <button data-testid="choose-${role.key}" type="submit" aria-label="以${escapeHtml(role.title)}身份继续登录">
      <span class="role-mark" aria-hidden="true">${roleMark(role.key)}</span>
      <span class="role-copy"><span class="role-tag">${roleTag(role)}</span><strong>${escapeHtml(role.title)}</strong><span>${escapeHtml(role.summary)}</span><code>${escapeHtml(role.email)}</code></span>
      <span class="oidc-role-action" aria-hidden="true"><span>选择</span><b>→</b></span>
    </button>
  </form>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>选择开发角色 · CrewStation</title><style>${STYLES}${OIDC_ROLE_STYLES}</style></head><body>
  <main class="oidc-choice"><header><div class="brand"><span class="logo">CS</span><div><small>CREWSTATION · LOCAL DEV</small><h1>选择开发角色</h1></div></div><a href="http://console.cs.localhost/">取消并返回</a></header>
  <section class="notice"><strong>真实 OAuth 登录</strong><span>选择本次验收使用的权限视角，随后返回 CrewStation。</span></section>
  <section class="roles" aria-label="开发角色">${cards}</section>
  <footer><span>Provider <code>dev-roles</code></span><span>OAuth 2.0 / OIDC</span></footer></main>
  </body></html>`;
}

const STYLES = `
  :root{color-scheme:dark;--bg:#090b10;--panel:#121722;--line:#283145;--text:#f5f7fb;--muted:#94a0b5;--accent:#55e6a5;--warn:#ffcb66;--bad:#ff7385;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#182438 0,transparent 34rem),var(--bg);color:var(--text);min-height:100vh}main{width:min(1060px,calc(100% - 32px));margin:auto;padding:28px 0 20px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.brand{display:flex;gap:14px;align-items:center}.logo{display:grid;place-items:center;width:48px;height:48px;border:1px solid #48d699;border-radius:13px;background:#143529;color:var(--accent);font:800 16px/1 ui-monospace,monospace;box-shadow:0 0 28px #55e6a522}small{display:block;color:var(--accent);font:700 11px/1.4 ui-monospace,monospace;letter-spacing:.13em}h1{font-size:24px;margin:2px 0 0;letter-spacing:-.03em}header a{color:#c7d2e5;text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:9px 12px;font-size:13px}.notice,.action-notice,.status,.project{display:flex;align-items:center;gap:14px;border:1px solid var(--line);background:#0e131cdd;padding:11px 13px;font-size:13px}.notice{border-radius:12px 12px 0 0}.notice strong,.action-notice strong{color:var(--warn);white-space:nowrap}.notice span,.action-notice span,.project span,.status span{color:var(--muted)}.action-notice{border-top:0;background:#241e14}.status{border-top:0}.status b{white-space:nowrap}.status.ready b{color:var(--accent)}.status.pending b{color:var(--warn)}.status.error b{color:var(--bad)}.status form{margin-left:auto}.status button{border:1px solid #814653;background:#311a20;color:#ffc0ca;border-radius:7px;padding:5px 9px}.project{border-top:0;border-radius:0 0 12px 12px}.project label{font-weight:700;white-space:nowrap}.project select{min-width:280px;max-width:48%;background:#171e2b;color:var(--text);border:1px solid #38445b;border-radius:7px;padding:7px 9px}.roles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.role-card{display:grid;grid-template-columns:48px 1fr auto;gap:12px;align-items:center;background:linear-gradient(145deg,#151b27,#10151e);border:1px solid var(--line);border-radius:12px;padding:14px;min-height:116px}.role-card:hover{border-color:#45536d}.role-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#1c2636;color:#9fb1cd;font:800 15px/1 ui-monospace,monospace}.role-admin .role-mark{background:#143529;color:var(--accent)}.role-tag{display:inline-block;color:#8fa0bb;font:650 10px/1 ui-monospace,monospace;text-transform:uppercase}.role-copy h2{font-size:16px;margin:5px 0 3px}.role-copy p{font-size:12px;line-height:1.5;color:var(--muted);margin:0}.role-card button{align-self:stretch;border:0;border-radius:9px;background:#eef4ff;color:#111722;font-weight:750;padding:0 13px;cursor:pointer}.role-card button span{display:block;font-size:18px}.role-card button:disabled{background:#252c38;color:#6e7889;cursor:not-allowed}footer{display:flex;justify-content:space-between;margin-top:12px;color:#68758a;font-size:11px;padding:0 2px}code{font-family:ui-monospace,monospace;color:#93dcb9}@media(max-width:760px){main{width:min(100% - 20px,560px);padding-top:16px}header{align-items:flex-start}header a{font-size:0}header a::after{content:'控制台 ↗';font-size:12px}.roles{grid-template-columns:1fr}.project{align-items:flex-start;flex-wrap:wrap}.project select{order:3;max-width:none;width:100%}.project span{font-size:11px}.role-card{grid-template-columns:42px 1fr auto;padding:12px}.role-mark{width:40px;height:40px}.notice,.action-notice{align-items:flex-start}footer{flex-direction:column;gap:4px}}
`;

const OIDC_ROLE_STYLES = `
  .oidc-choice{width:min(860px,calc(100% - 32px))}.oidc-choice .notice{border-radius:12px;margin-bottom:12px}.oidc-role-option{margin:0}.oidc-role-option>button{display:grid;grid-template-columns:44px minmax(0,1fr) 64px;gap:12px;align-items:center;width:100%;min-height:116px;margin:0;padding:14px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(145deg,#151b27,#10151e);color:var(--text);text-align:left;cursor:pointer}.oidc-role-option>button:hover{border-color:#55e6a5;background:linear-gradient(145deg,#182331,#121a24);box-shadow:0 8px 24px #0005}.oidc-role-option>button:active{transform:translateY(1px)}.oidc-role-option>button:focus-visible{outline:2px solid #55e6a5;outline-offset:3px}.oidc-role-option .role-copy{min-width:0}.oidc-role-option .role-copy strong,.oidc-role-option .role-copy>span{display:block}.oidc-role-option .role-copy strong{margin:5px 0 3px;font-size:16px}.oidc-role-option .role-copy>span:last-of-type{color:var(--muted);font-size:12px;line-height:1.5}.oidc-role-option .role-copy code{display:block;margin-top:7px;overflow:hidden;color:#73839c;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.oidc-role-action{display:grid;place-items:center;align-self:stretch;border-radius:9px;background:#eef4ff;color:#111722;font-size:11px;font-weight:750;text-align:center}.oidc-role-action b{font-size:18px}@media(max-width:760px){.oidc-choice{width:min(100% - 20px,560px)}.oidc-role-option>button{grid-template-columns:40px minmax(0,1fr) 52px;padding:12px}.oidc-role-action{font-size:10px}}
`;
