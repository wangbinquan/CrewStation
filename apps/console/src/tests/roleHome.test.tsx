import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import type { PlatformRole } from '@crewstation/contracts';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
const userId = `01a0bf5d-8f4b-799e-8662-91273789253a`, projectId = `01a0bf5d-8f4b-791e-89de-7760fac24856`, otherId = `01a0bf5d-8f4b-7e44-886a-b79b12465703`;

function fixture(role: PlatformRole = 'user') {
  const state = { role, targetRole: 'user' as PlatformRole, trial: true, created: false, failCreate: false, conflict: false, denied: false };
  const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const project = { id: projectId, name: '团队助理', slug: 'team-helper', kind: 'DigitalWorker', state: 'provisioning', ownerUserId: userId, namespace: 'cs-team-helper', createdAt: '2026-09-20T00:00:00.000Z' };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ path, method, body });
    let data: unknown = { items: [] }, status = 200;
    if (path === '/v1/me') { data = { id: userId, name: '小林', email: 'lin@test.invalid', platformRole: state.role, isAdmin: state.role === 'admin', memberships: state.created ? [{ projectId, role: 'owner' }] : state.trial ? [{ projectId, role: 'tester' }] : [], authMethod: 'oidc' }; if (state.denied) { data = { error: 'unavailable', message: '身份暂不可用' }; status = 503; } }
    else if (path === '/v1/users') data = { items: [{ id: otherId, name: '小周', email: 'zhou@test.invalid', platformRole: state.targetRole, isAdmin: state.targetRole === 'admin' }] };
    else if (path.endsWith('/platform-role')) { if (state.conflict) { status = 409; data = { error: 'conflict', message: '角色已被另一管理员修改' }; } else { state.targetRole = body!.platformRole as PlatformRole; data = { id: otherId, platformRole: state.targetRole }; } }
    else if (path === '/v1/catalog/project-creation') data = { templates: [{ id: '01a0bf5d-8f4b-7002-9560-94caf593fb19', name: 'minimal-sample', kind: 'DigitalWorker', servicePlan: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', requiredConfig: [] }], defaultServicePlan: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', maxConcurrentTasks: 3 };
    else if (path === '/v1/projects' && method === 'POST') {
      if (state.failCreate) { status = 409; data = { error: 'conflict', message: '该标识已存在', details: { field: 'slug' } }; }
      else { state.created = true; data = project; status = 201; }
    } else if (path === `/v1/projects/${projectId}`) data = project;
    else if (path.startsWith('/v1/market/apps')) {
      const app = { projectId, name: '团队助理', icon: 'assistant', description: '帮你整理会议纪要', owner: { userId, name: '负责人' }, projectState: 'active', canPreview: state.trial, canDevelop: false, canConfigure: false,
        entry: { kind: 'trial', status: 'ready', host: 'preview.team.example.test' }, production: { status: 'not-deployed', freshness: 'current', checkedAt: '2026-09-20T00:00:00.000Z' }, checkedAt: '2026-09-20T00:00:00.000Z', visibilityRevision: 1 };
      data = path === '/v1/market/apps' ? { items: [app] } : app;
    }
    return Response.json(data, { status });
  }) as typeof fetch;
  return { state, calls, project };
}

async function change(selector: string, value: string) {
  const node = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  await act(async () => {
    node.focus(); Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}

test.each(['user', 'developer', 'admin'] as const)('%s 默认首页只有应用内容与获准空间，Beta 直接打开且无技术请求', async (role) => {
  const f = fixture(role); page = await renderApp('/');
  expect(page.text()).toContain('Beta'); expect(page.text()).toContain('试用应用'); expect(page.text()).toContain('共用业务数据');
  expect(page.html()).toContain('href="http://preview.team.example.test"'); expect(page.text()).not.toContain('Agent 动态');
  expect(Boolean(document.querySelector('a[href="/projects"]'))).toBe(role !== 'user');
  expect(Boolean(document.querySelector('a[href="/admin"]'))).toBe(role === 'admin');
  expect(f.calls.every((c) => c.path === '/v1/me' || c.path.startsWith('/v1/market/apps'))).toBe(true);
});

test('普通用户开发 URL 被拒绝，旧试用项目链接迁移到市场，不挂开发页面', async () => {
  const f = fixture(); page = await renderApp('/projects/new');
  expect(page.text()).toContain('需要开发者角色'); expect(f.calls.every((c) => c.path === '/v1/me')).toBe(true);
  await page.navigate(`/projects/${projectId}/dev-session`); expect(page.path()).toBe('/market');
  expect(f.calls.some((c) => c.path.includes('/dev-session') || c.path.startsWith('/v1/projects'))).toBe(false);
});

test.each(['developer', 'admin'] as const)('%s 项目列表和新建页不重复全局导航，进入项目后才出现项目菜单', async (role) => {
  const f = fixture(role); f.state.trial = false; f.state.created = true;
  page = await renderApp('/projects');
  // 实机项目列表的左栏重复了顶栏的“应用／项目开发”，白占一列。
  expect(Boolean(document.querySelector('nav[aria-label="主导航"]'))).toBe(false);
  expect(document.querySelectorAll('a[href="/market"]')).toHaveLength(1);
  expect(document.querySelectorAll('a[href="/projects"]')).toHaveLength(1);
  await page.click('新建项目'); expect(page.path()).toBe('/projects/new');
  expect(Boolean(document.querySelector('nav[aria-label="主导航"]'))).toBe(false);
  await page.navigate(`/projects/${projectId}/settings`);
  const nav = document.querySelector('nav[aria-label="主导航"]')!;
  expect(nav.querySelectorAll('[aria-label="项目页面"] a')).toHaveLength(5);
  expect(Boolean(nav.querySelector('a[href="/market"]'))).toBe(false);
  const back = nav.querySelector<HTMLAnchorElement>('a[href="/projects"]')!;
  await act(async () => back.click()); await page.settle();
  expect(page.path()).toBe('/projects');
  expect(Boolean(document.querySelector('nav[aria-label="主导航"]'))).toBe(false);
  await page.navigate('/missing-page');
  expect(Boolean(document.querySelector('nav[aria-label="主导航"]'))).toBe(false);
});

test('首页自动更新收到异常响应时保留搜索输入，提示重试并能恢复应用列表', async () => {
  fixture(); const base = globalThis.fetch; let invalid = false;
  globalThis.fetch = (async (raw, init) => invalid && new URL(String(raw), 'http://localhost').pathname === '/v1/market/apps'
    ? new Response('<html>暂不可用</html>', { headers: { 'content-type': 'text/html' } }) : base(raw, init)) as typeof fetch;
  page = await renderApp('/'); await change('main input', '会议草稿');
  // 实机自动刷新后取到没有 items 的响应，旧页面在 items.length 处崩溃。
  invalid = true;
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  expect(page.text()).toContain('应用列表返回的内容不完整。'); expect(page.text()).toContain('稍后会自动重新读取');
  expect(page.text()).not.toContain('Something went wrong');
  expect(document.querySelector<HTMLInputElement>('main input')?.value).toBe('会议草稿');
  // 2026-09-23 裁定：没有「重新查询」按钮，市场每 15 秒自动重读；reread 模拟一次自动重读。
  expect(page.text()).not.toContain('重新查询'); invalid = false; await page.reread();
  expect(page.text()).toContain('团队助理'); expect(page.text()).not.toContain('应用列表返回的内容不完整');
  expect(document.querySelector<HTMLInputElement>('main input')?.value).toBe('会议草稿');
});

test('身份失败显示重试，不使用旧开发身份放行或挂载目录', async () => {
  const f = fixture('developer'); f.state.denied = true; page = await renderApp('/projects');
  expect(page.text()).toContain('身份暂不可用'); expect(page.text()).not.toContain('需要开发者角色');
  expect(f.calls.every((c) => c.path === '/v1/me')).toBe(true);
});

test('开发者表单初始约束可见，逐字段错误与焦点正确，冲突保留输入并成功接续开通', async () => {
  const f = fixture('developer'); f.state.trial = false; page = await renderApp('/projects/new');
  expect(page.text()).toContain('平台默认资源'); expect(page.text()).toContain('3–40');
  await page.click('创建项目'); expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3);
  expect(document.activeElement?.getAttribute('name')).toBe('name');
  await change('[name="name"]', '团队助理'); await change('[name="slug"]', 'team-helper'); await change('[name="template"]', '01a0bf5d-8f4b-7002-9560-94caf593fb19');
  f.state.failCreate = true; await page.click('创建项目'); expect(page.text()).toContain('该标识已存在'); expect(document.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('团队助理');
  f.state.failCreate = false; await page.click('创建项目'); await page!.settle(); expect(page.path()).toBe(`/projects/${projectId}/provisioning`);
  const request = f.calls.find((c) => c.method === 'POST')!;
  expect(request.body).toEqual({ name: '团队助理', slug: 'team-helper', template: '01a0bf5d-8f4b-7002-9560-94caf593fb19', kind: 'DigitalWorker' });
  expect(f.calls.some((c) => c.path === '/v1/users')).toBe(false);
});

test('管理员修改角色有确认，409 保留选择并重新读取后再保存', async () => {
  const f = fixture('admin'); page = await renderApp('/admin/users');
  await page.click('管理权限');
  await act(async () => document.querySelector<HTMLInputElement>('input[value="developer"]')!.click());
  await page.click('检查变更');
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull(); f.state.conflict = true;
  await page.click('保存角色'); expect(page.text()).toContain('角色已被另一管理员修改');
  expect(document.querySelector<HTMLInputElement>('input[value="developer"]')?.checked).toBe(true);
  await page.click('重新读取当前角色'); f.state.conflict = false; await page.click('检查变更'); await page.click('保存角色');
  expect(f.state.targetRole).toBe('developer'); expect(f.calls.find((c) => c.method === 'PUT')?.body).toEqual({ platformRole: 'developer', expectedRole: 'user' });
});

test('已上线应用卡片保留正式入口和独立 Beta 链接，自动更新移除过期试用入口', async () => {
  const f = fixture(), base = globalThis.fetch; let ready = true;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    const response = await base(raw, init);
    if (path === '/v1/market/apps') return Response.json({ items: [{ ...(await response.json()).items[0],
      trial: ready ? { status: 'ready', host: 'new.team.test' } : { status: 'unavailable' },
      entry: { kind: 'production', status: 'ready', host: 'team.test' }, production: { status: 'deployed', tag: 'v1', commitSha: 'a'.repeat(40), host: 'team.test', state: 'ready', freshness: 'current', checkedAt: new Date().toISOString() } }] });
    return response;
  }) as typeof fetch;
  page = await renderApp('/market'); expect(page.text()).not.toContain('v1');
  expect(document.querySelector('a[href="http://team.test"]')?.textContent).toBe('团队助理');
  const beta = document.querySelector<HTMLAnchorElement>('a[href="http://new.team.test"]')!;
  expect(beta.textContent).toContain('试用新版本'); expect(beta.target).toBe('_blank');
  expect(beta.parentElement?.closest('a')).toBeNull(); expect(page.text()).toContain('共用业务数据');
  expect(document.querySelector('h2')?.textContent).not.toContain('Beta');
  ready = false; await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  expect(document.querySelector('a[href="http://team.test"]')).not.toBeNull(); expect(document.querySelector('a[href="http://new.team.test"]')).toBeNull();
  expect(page.text()).toContain('暂不可用');
  expect(f.calls.every((call) => call.path === '/v1/me' || call.path === '/v1/market/apps')).toBe(true);
});

test('开发身份刷新失败不丢自建草稿且暂停创建，恢复后仍需显式提交', async () => {
  const f = fixture('developer'); f.state.trial = false; page = await renderApp('/projects/new');
  await change('[name="name"]', '保留输入'); f.state.denied = true;
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  const field = document.querySelector<HTMLInputElement>('[name="name"]')!;
  expect(field.value).toBe('保留输入'); expect(field.closest('[hidden]')).not.toBeNull();
  await act(async () => field.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(f.calls.some((call) => call.method === 'POST')).toBe(false);
  f.state.denied = false; await page.reread(); expect(document.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('保留输入');
  expect(f.calls.some((call) => call.method === 'POST')).toBe(false);
});

test('自建回执丢失先核对本人同标识项目，不重复提交已创建的项目', async () => {
  const f = fixture('developer'), base = globalThis.fetch; f.state.trial = false;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path === '/v1/projects/page') return Response.json({ items: [{ project: f.project, role: 'owner', ownerName: '小林' }] });
    const response = await base(raw, init);
    if (path === '/v1/projects' && init?.method === 'POST') throw new TypeError('创建回执中断');
    return response;
  }) as typeof fetch;
  page = await renderApp('/projects/new');
  await change('[name="name"]', '团队助理'); await change('[name="slug"]', 'team-helper'); await change('[name="template"]', '01a0bf5d-8f4b-7002-9560-94caf593fb19');
  await page.click('创建项目'); expect(page.text()).toContain('回执'); expect(document.querySelector<HTMLInputElement>('[name="slug"]')?.disabled).toBe(true);
  await page.click('核对创建结果'); expect(page.path()).toBe(`/projects/${projectId}/provisioning`);
  expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(1); expect(sessionStorage.getItem(`cs-project-draft:${userId}`)).toBeNull();
});
