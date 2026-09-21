import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { adminDirectoryFixture } from './adminDirectoryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

test('管理总览显示三类真实待办，各取五条；失败来源保持错误，入口只导航', async () => {
  const f = adminDirectoryFixture(); f.state.egressError = true; page = await renderApp('/admin');
  expect(page.text()).toContain('待处理事项'); expect(page.text()).toContain(f.apiRequests[0]!.operationId);
  expect(page.text()).toContain('出站待办离线'); expect(page.text()).toContain('生产配置尚未补齐');
  expect(page.text()).not.toContain(f.apiRequests[5]!.operationId);
  const requests = f.calls.filter((c) => c.url.pathname.endsWith('/page'));
  expect(requests).toHaveLength(3); expect(requests.every((c) => c.url.searchParams.get('limit') === '5')).toBe(true);
  expect(f.calls.some((c) => c.url.pathname === '/v1/projects')).toBe(false);
  await page.click(f.apiRequests[0]!.operationId); expect(page.path()).toBe('/admin/requests');
  expect(page.search()).toMatchObject({ tab: 'api', state: 'pending', projectId: f.projects[0]!.project.id }); expect(f.writes()).toHaveLength(0);
});

test('全项目管理是实际管理员路由，默认分页 20，不拉全量目录', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/projects');
  expect(page.text()).toContain('项目管理'); expect(page.text()).toContain('管理项目 0'); expect(page.text()).not.toContain('管理项目 20');
  const query = f.calls.find((c) => c.url.pathname === '/v1/projects/page')!.url.searchParams;
  expect(query.get('limit')).toBe('20'); expect(query.get('kind')?.split(',').sort()).toEqual(['APIProxy', 'DigitalWorker', 'EventProducer']);
  expect(f.calls.some((c) => c.url.pathname === '/v1/projects')).toBe(false);
  await page.click('下一页'); expect(page.search().cursor).toBe('20'); expect(page.text()).toContain('管理项目 20');
  await page.back(); expect(page.search().cursor).toBeUndefined(); expect(page.text()).toContain('管理项目 0'); expect(f.writes()).toHaveLength(0);
});

async function field(label: string, value: string) {
  const node = document.querySelector<HTMLInputElement | HTMLSelectElement>(`input[aria-label="${label}"], select[aria-label="${label}"]`)!;
  await act(async () => { node.focus(); const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}

test('目录搜索与类型、开通状态在 URL 保留，改条件回第一页，接入入口保持两种类型', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/projects?cursor=20');
  await field('名称或标识', 'managed-2'); await field('项目类型', 'APIProxy'); await field('开通状态', 'active'); await page.click('查询项目');
  expect(page.search()).toMatchObject({ q: 'managed-2', kind: 'APIProxy', state: 'active' }); expect(page.search().cursor).toBeUndefined();
  expect(page.text()).toContain('管理项目 22'); expect(page.text()).not.toContain('管理项目 20');
  await page.navigate('/admin/capabilities?tab=integrations');
  const query = f.calls.filter((c) => c.url.pathname === '/v1/projects/page').at(-1)!.url.searchParams;
  expect(query.get('kind')).toBe('APIProxy,EventProducer'); expect(page.text()).not.toContain('管理项目 0');
  await page.click('管理项目 1'); expect(page.path()).toBe(`/admin/integrations/${f.projects[1]!.project.id}`);
});

test('待办独立加载、空态与错误不混淆，失败来源单独重读后恢复', async () => {
  const f = adminDirectoryFixture(); let release!: () => void; f.state.holdApi = new Promise<void>((r) => { release = r; });
  page = await renderApp('/admin');
  const card = () => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === '待审批 API 申请')!;
  expect(card().textContent).toContain('数量未确认'); expect(card().textContent).not.toContain('当前没有待处理事项'); expect(page.text()).toContain('api-0.example.test');
  f.state.apiError = true; await act(async () => release()); await page.settle(); expect(card().textContent).toContain('API 待办离线');
  expect(card().textContent).not.toContain('本次显示 0 项'); f.state.holdApi = undefined; f.state.apiError = false;
  await page.click('刷新 API 待办'); expect(card().textContent).toContain(f.apiRequests[0]!.operationId); expect(card().textContent).toContain('还有更多');
  f.apiRequests.length = 0; await page.click('刷新 API 待办'); expect(card().textContent).toContain('当前没有待处理事项'); expect(card().textContent).toContain('本次显示 0 项');
});

test('管理目录读取失败保留材料但暂停管理动作，无效回执不冒充空目录', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/projects'); f.state.projectError = true;
  await page.click('刷新项目目录'); expect(page.text()).toContain('管理项目目录离线'); expect(page.text()).toContain('显示上次读取的项目');
  expect(document.querySelectorAll('a[href$="/provisioning"]').length).toBe(0); expect(page.text()).not.toContain('本页 0 个项目');
  f.state.projectError = false; await page.click('刷新项目目录'); expect(document.querySelectorAll('a[href$="/provisioning"]').length).toBe(12);
  await page.click('管理成员'); expect(page.path()).toBe(`/projects/${f.projects[0]!.project.id}/settings`); expect(page.search().tab).toBe('members');
  f.state.invalidProject = true; await page.navigate('/admin/projects?q=unknown'); expect(page.text()).toContain('管理项目目录或当前管理身份未确认');
  expect(page.text()).not.toContain('此范围没有项目'); expect(page.text()).toContain('本页数量未确认'); expect(f.writes()).toHaveLength(0);
});

test('空筛选可恢复；前台重读保留未提交搜索，卸载清理监听', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/projects?q=no-match'); expect(page.text()).toContain('此范围没有项目');
  await page.click('清除筛选'); await field('名称或标识', '尚未查询的名称');
  const previous = Object.getOwnPropertyDescriptor(document, 'visibilityState'); let visibility = 'hidden';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  try {
    const reads = () => f.calls.filter((c) => c.url.pathname === '/v1/projects/page').length, before = reads();
    await act(async () => document.dispatchEvent(new Event('visibilitychange'))); await page.settle(); expect(reads()).toBe(before);
    visibility = 'visible'; await act(async () => document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))); await page.settle(); expect(reads()).toBe(before + 1);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="名称或标识"]')!.value).toBe('尚未查询的名称');
    page.unmount(); page = undefined; const last = f.calls.length; document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); expect(f.calls.length).toBe(last);
  } finally { if (previous) Object.defineProperty(document, 'visibilityState', previous); else Reflect.deleteProperty(document, 'visibilityState'); }
});

test('管理身份读取失败可重试；身份撤销后移除管理内容且不再读取目录', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/projects'); f.state.identityError = true;
  await page.click('刷新项目目录'); expect(page.text()).toContain('管理身份离线');
  expect([...document.querySelectorAll('a')].filter((node) => !node.closest('[hidden]')).some((node) => node.textContent?.includes('管理项目 0'))).toBe(false);
  f.state.identityError = false; await page.click('重新检查权限'); expect(page.text()).toContain('管理项目 0');
  f.state.admin = false; const before = f.calls.filter((c) => c.url.pathname === '/v1/projects/page').length;
  await page.click('刷新项目目录'); expect(page.text()).toContain('仅平台管理员可见'); expect(page.text()).not.toContain('管理项目 0');
  expect(f.calls.filter((c) => c.url.pathname === '/v1/projects/page')).toHaveLength(before); expect(f.writes()).toHaveLength(0);
});

test('例行重读不改界面，入口只在手动刷新时暂停', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin');
  const entry = () => [...document.querySelectorAll('a, span')].find((node) => node.textContent === f.apiRequests[0]!.operationId)!;
  expect(entry().tagName).toBe('A');
  // 回到前台走的是同一条例行重读：在途也不把入口换成纯文本。
  let release!: () => void; f.state.holdApi = new Promise<void>((r) => { release = r; });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page.settle();
  const reads = () => f.calls.filter((c) => c.url.pathname === '/v1/api-requests/page').length;
  expect(reads()).toBe(2); expect(entry().tagName).toBe('A');
  await act(async () => release()); await page.settle(); expect(entry().tagName).toBe('A');
  // 手动刷新是用户自己触发的：在途期间仍然暂停入口，读完恢复。
  f.state.holdApi = new Promise<void>((r) => { release = r; });
  await page.click('刷新 API 待办'); expect(reads()).toBe(3); expect(entry().tagName).toBe('SPAN');
  f.state.holdApi = undefined; await act(async () => release()); await page.settle(); expect(entry().tagName).toBe('A');
});
