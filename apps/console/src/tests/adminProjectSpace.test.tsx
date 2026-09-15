import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { rememberWorkbenchPath } from '../app/layout/spaceMemory';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = `prj_${'1'.repeat(32)}`, serviceId = `svc_${'2'.repeat(32)}`, taskId = `tsk_${'3'.repeat(32)}`;
const project = { id: projectId, serviceId, name: '公司接口接入', slug: 'company-api', kind: 'APIProxy', state: 'active', namespace: 'cs-company-api', createdAt: '2026-09-13T01:00:00.000Z' };
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(options: { admin?: boolean; pendingMe?: boolean; meFailure?: boolean; projectFailure?: boolean; digitalWorker?: boolean } = {}) {
  const calls: string[] = [];
  const state = { ...options };
  globalThis.fetch = (async (raw) => {
    const url = String(raw); calls.push(url);
    let body: unknown = { items: [] }, status = 200;
    if (url.endsWith('/v1/me')) {
      if (state.pendingMe) return new Promise<Response>(() => {});
      if (state.meFailure) { status = 503; body = { error: 'unavailable', message: '身份读取失败' }; }
      else body = { id: 'user', name: '管理员', email: 'admin@example.invalid', isAdmin: state.admin !== false, memberships: [] };
    } else if (url.endsWith(`/v1/projects/${projectId}`)) {
      if (state.projectFailure) { status = 503; body = { error: 'unavailable', message: '项目目录读取失败' }; }
      else body = { ...project, kind: state.digitalWorker ? 'DigitalWorker' : 'APIProxy' };
    } else if (url.includes('/v1/projects/page?')) body = { items: [{ project: { ...project, ownerUserId: `usr_${'a'.repeat(32)}` }, role: 'admin', ownerName: '管理员' }] };
    else if (url.includes('/v1/projects?')) body = { items: [project] };
    else if (url.endsWith(`/v1/services/${serviceId}`)) body = { id: serviceId, projectId };
    else if (url.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '当前没有开发会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, state };
}

describe('管理接入容器复用业务页面', () => {
  test('管理列表直接打开管理详情，项目导航及发布／设置始终保留空间', async () => {
    fixture(); page = await renderApp('/admin/integrations');
    await page.click('公司接口接入'); expect(page.path()).toBe(`/admin/integrations/${projectId}`);
    expect(document.querySelector('[aria-label="项目页面"]')?.textContent).toContain('发布与上线');
    expect(page.text()).toContain('返回接入容器');
    expect(document.querySelector('nav details')).not.toBeNull();
    expect(document.querySelector('nav details')!.hasAttribute('open')).toBe(false);
    await page.click('发布与上线'); expect(page.path()).toBe(`/admin/integrations/${projectId}/release`);
    await page.click('项目设置'); expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
    expect(page.text()).not.toContain('应用可见性');
    await page.click('配置与密钥'); await page.click('生产取值组');
    expect(page.search()).toMatchObject({ tab: 'config', env: 'production' });
    expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
    await page.click('返回接入容器'); expect(page.path()).toBe('/admin/capabilities'); expect(page.search().tab).toBe('integrations');
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
    expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.search().tab).toBe('repository');
    expect(page.text()).toContain('能力市场');
  });

  test('接入项目的可见性链接归位成员，不请求市场设置', async () => {
    const f = fixture(); page = await renderApp(`/admin/integrations/${projectId}/settings?tab=visibility`);
    expect(page.search().tab).toBe('members'); expect(page.text()).not.toContain('应用可见性');
    expect(f.calls.some((url) => url.includes('/app-visibility') || url.includes('/app-presentation'))).toBe(false);
  });
});

test('旧租户接入链接不能覆盖原工作台返回位置', async () => {
  fixture(); page = await renderApp('/projects?q=return-project');
  await page.navigate(`/projects/${projectId}/logs?source=slot&slot=prod&limit=300`);
  expect(page.path()).toBe(`/admin/integrations/${projectId}/operations`);
  await page.click('回到工作台');
  // 实机把旧租户地址记进返回位置，按钮回程又被项目类型边界重定向到管理页。
  expect(page.path()).toBe('/projects'); expect(page.search().q).toBe('return-project');
});

test('直接打开旧接入链接时，返回工作台使用初始位置，不在两空间循环', async () => {
  rememberWorkbenchPath('/'); // 模拟整页载入时空间记忆的初始值。
  fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=repository`);
  expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
  await page.click('回到工作台');
  expect(page.path()).toBe('/'); expect(page.text()).toContain('能力市场');
});

test('旧接入项目读取失败再恢复，不会把待识别地址保存成工作台返回位置', async () => {
  const f = fixture({ projectFailure: true }); page = await renderApp('/projects?q=keep-on-error');
  await page.navigate(`/projects/${projectId}/settings?tab=repository`);
  expect(page.text()).toContain('项目目录读取失败');
  f.state.projectFailure = false; await page.click('重新读取项目');
  expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`);
  await page.click('回到工作台');
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

  test('项目读取失败不跳错空间，显式重试可接回正确页面', async () => {
    const f = fixture({ projectFailure: true }); page = await renderApp(`/projects/${projectId}/settings?tab=repository`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.text()).toContain('项目目录读取失败');
    f.state.projectFailure = false; await page.click('重新读取项目');
    expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`); expect(page.search().tab).toBe('repository');
  });

  test('普通成员收到接入项目信息仍保留拒绝页，不挂载业务操作', async () => {
    const f = fixture({ admin: false }); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.text()).toContain('仅平台管理员可见');
    expect(f.calls.some((url) => url.includes('/config/'))).toBe(false);
  });
});
