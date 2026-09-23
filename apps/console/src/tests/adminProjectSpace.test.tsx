import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { rememberWorkbenchPath } from '../app/layout/spaceMemory';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = '01a0bf5d-8f4b-7148-804c-6bd655d243f6', serviceId = '01a0bf5d-8f4b-76be-8473-58312e41bdd7', taskId = '01a0bf5d-8f4b-7954-8f77-0beb0852f027';
const project = { id: projectId, serviceId, name: '公司接口接入', slug: 'company-api', kind: 'APIProxy', state: 'active', namespace: 'cs-company-api', createdAt: '2026-09-13T01:00:00.000Z' };
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(options: { admin?: boolean; pendingMe?: boolean; meFailure?: boolean; projectFailure?: boolean; projectMissing?: boolean; digitalWorker?: boolean } = {}) {
  const calls: string[] = [];
  const state = { ...options };
  globalThis.fetch = (async (raw) => {
    const url = String(raw); calls.push(url);
    let body: unknown = { items: [] }, status = 200;
    if (url.endsWith('/v1/me')) {
      if (state.pendingMe) return new Promise<Response>(() => {});
      if (state.meFailure) { status = 503; body = { error: 'unavailable', message: '身份读取失败' }; }
      else body = { id: 'user', name: '管理员', email: 'admin@example.invalid', platformRole: (state.admin !== false) ? 'admin' : 'developer', isAdmin: state.admin !== false, memberships: [] };
    } else if (url.endsWith(`/v1/projects/${projectId}`)) {
      if (state.projectMissing) { status = 404; body = { error: 'not_found', message: '项目不存在' }; }
      else if (state.projectFailure) { status = 503; body = { error: 'unavailable', message: '项目目录读取失败' }; }
      else body = { ...project, kind: state.digitalWorker ? 'DigitalWorker' : 'APIProxy' };
    } else if (url.includes('/v1/projects/page?')) body = { items: [{ project: { ...project, ownerUserId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0' }, role: 'admin', ownerName: '管理员' }] };
    else if (url.includes('/v1/projects?')) body = { items: [project] };
    else if (url.endsWith(`/v1/services/${serviceId}`)) body = { id: serviceId, projectId };
    else if (url.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '当前没有开发会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, state };
}

describe('管理接入容器复用业务页面', () => {
  test.each(['/admin/projects', '/admin/integrations'])('%s 打开项目后，子页面返回项目管理并高亮正确菜单', async (entry) => {
    fixture(); page = await renderApp(entry);
    await page.click('公司接口接入'); expect(page.path()).toBe(`/admin/integrations/${projectId}`);
    expect(document.querySelector('[aria-label="项目页面"]')?.textContent).toContain('发布与上线');
    expect(page.text()).toContain('返回项目管理');
    expect(document.querySelector('nav details')).toBeNull();
    await page.click('发布与上线'); expect(page.path()).toBe(`/admin/integrations/${projectId}/release`);
    await page.click('项目设置'); expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
    expect(page.text()).not.toContain('应用可见性');
    await page.click('环境变量'); await page.click('生产');
    expect(page.search()).toMatchObject({ tab: 'config', env: 'production' });
    expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
    // 从项目管理进入后，旧返回链接却写死到了能力接入。
    await page.click('返回项目管理'); expect(page.path()).toBe('/admin/projects');
    expect(document.querySelector('nav[aria-label="主导航"] a[aria-current="page"]')?.textContent).toBe('项目管理');
  });

  test('项目深链接的顶栏返回平台管理也落在项目目录', async () => {
    fixture(); page = await renderApp(`/admin/integrations/${projectId}/release`);
    await page.click('平台管理'); expect(page.path()).toBe('/admin/projects');
    expect(document.querySelector('nav[aria-label="主导航"] a[aria-current="page"]')?.textContent).toBe('项目管理');
  });

  test('缺失项目正文中的返回链接也回项目管理', async () => {
    fixture({ projectMissing: true }); page = await renderApp(`/admin/integrations/${projectId}`);
    expect(document.querySelector('main a[href="/admin/projects"]')?.textContent).toBe('返回项目管理');
  });

  test('旧租户日志链接逐级 replace 到管理诊断，任务条件和返回栈保持', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/logs?source=dev-session&taskId=${taskId}&limit=300`, '/projects');
    expect(page.path()).toBe(`/admin/integrations/${projectId}/operations`);
    expect(page.search()).toMatchObject({ tab: 'logs', source: 'dev-session', taskId, limit: 300 });
    expect(f.calls.some((url) => url.includes(`/projects/${projectId}/logs?source=dev-session`) && url.includes(`taskId=${taskId}`))).toBe(true);
    await page.back(); expect(page.path()).toBe('/projects');
  });

  test('历史对话深链接保留 agent，返回 CLI 仍在管理路径', async () => {
    fixture(); page = await renderApp(`/admin/integrations/${projectId}/dev-session?view=conversation&agent=L-history`);
    expect(page.path()).toBe(`/admin/integrations/${projectId}/dev-session/conversations`);
    expect(page.search().agent).toBe('L-history');
    await page.click('返回 CLI 工作区'); expect(page.path()).toBe(`/admin/integrations/${projectId}/dev-session`);
  });

  test('数字人误入接入容器路径时回到自己的工作台页面，保留分类', async () => {
    fixture({ digitalWorker: true }); page = await renderApp(`/admin/integrations/${projectId}/settings?tab=repository`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.search().tab).toBe('info');
    expect(page.text()).toContain('项目开发');
  });

  test('接入项目的可见性链接归位环境变量，不请求市场设置', async () => {
    const f = fixture(); page = await renderApp(`/admin/integrations/${projectId}/settings?tab=visibility`);
    expect(page.search().tab).toBe('config'); expect(page.text()).not.toContain('应用展示');
    expect(f.calls.some((url) => url.includes('/app-visibility') || url.includes('/app-presentation'))).toBe(false);
  });
});

test('旧租户接入链接不能覆盖原工作台返回位置', async () => {
  fixture(); page = await renderApp('/projects?q=return-project');
  await page.navigate(`/projects/${projectId}/logs?source=slot&slot=prod&limit=300`);
  expect(page.path()).toBe(`/admin/integrations/${projectId}/operations`);
  await page.click('项目开发');
  // 实机把旧租户地址记进返回位置，按钮回程又被项目类型边界重定向到管理页。
  expect(page.path()).toBe('/projects'); expect(page.search().q).toBe('return-project');
});

test('直接打开旧接入链接时，返回工作台使用初始位置，不在两空间循环', async () => {
  rememberWorkbenchPath('/'); // 模拟整页载入时空间记忆的初始值。
  fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=repository`);
  expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
  await page.click('项目开发');
  expect(page.path()).toBe('/projects'); expect(page.text()).toContain('项目开发');
});

test('旧接入项目读取失败再恢复，不会把待识别地址保存成工作台返回位置', async () => {
  const f = fixture({ projectFailure: true }); page = await renderApp('/projects?q=keep-on-error');
  await page.navigate(`/projects/${projectId}/settings?tab=repository`);
  expect(page.text()).toContain('项目目录读取失败');
  // 没有「重新读取项目」按钮（2026-09-23 裁定）：读取失败自动重读，reread 模拟一次。
  f.state.projectFailure = false; await page.reread();
  expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
  await page.click('项目开发');
  expect(page.path()).toBe('/projects'); expect(page.search().q).toBe('keep-on-error');
});

describe('管理详情保持守卫的加载、失败与拒绝语义', () => {
  test('普通成员直达管理项目页面不会从顶栏或侧栏请求项目内部内容', async () => {
    const f = fixture({ admin: false }); page = await renderApp(`/admin/integrations/${projectId}/dev-session`);
    expect(page.text()).toContain('仅平台管理员可见'); expect(page.text()).not.toContain('公司接口接入');
    expect(f.calls.some((url) => url.includes('/v1/projects/') || url.includes('/v1/tasks/'))).toBe(false);
  });

  test('身份还在路上与身份读取失败不闪管理项目内容，也不误报普通成员', async () => {
    const f = fixture({ pendingMe: true }); page = await renderApp(`/admin/integrations/${projectId}/settings`);
    expect(page.text()).not.toContain('仅平台管理员可见'); expect(page.text()).not.toContain('公司接口接入');
    expect(f.calls.some((url) => url.includes('/v1/projects/'))).toBe(false);
    page.unmount(); page = undefined;
    const failed = fixture({ meFailure: true }); page = await renderApp(`/admin/integrations/${projectId}/settings`);
    expect(page.text()).toContain('身份读取失败'); expect(page.text()).not.toContain('仅平台管理员可见');
    expect(failed.calls.some((url) => url.includes('/v1/projects/'))).toBe(false);
  });

  test('项目读取失败不跳错空间，自动重读后接回正确页面', async () => {
    const f = fixture({ projectFailure: true }); page = await renderApp(`/projects/${projectId}/settings?tab=repository`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.text()).toContain('项目目录读取失败');
    expect(page.text()).not.toContain('重新读取项目'); f.state.projectFailure = false; await page.reread();
    expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`); expect(page.search().tab).toBe('info');
  });

  test('普通成员收到接入项目信息仍保留拒绝页，不挂载业务操作', async () => {
    const f = fixture({ admin: false }); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.text()).toContain('仅平台管理员可见');
    expect(f.calls.some((url) => url.includes('/config/'))).toBe(false);
  });
});
