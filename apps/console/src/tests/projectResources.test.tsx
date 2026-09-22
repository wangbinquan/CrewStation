import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { parseResourceSearch } from '../shared/project/resourceSearch';
import { renderApp } from './renderApp';
import { projectResourcesFixture, resourcesProjectId as id } from './projectResourcesFixture';
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

for (const admin of [false, true]) {
  const prefix = admin ? '/admin/integrations' : '/projects';
  test.each([
    ['resources&resource=api&proxy=billing&operation=billing.get', { view: 'reference', panel: 'full', topic: 'api', proxy: 'billing', operation: 'billing.get' }],
    ['resources&resource=events&subscription=01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd', { view: 'reference', panel: 'full', topic: 'events', subscription: '01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd' }],
  ])(`旧设置迁移保留空间与参数 ${prefix} / %s`, async (tab, expected) => {
    // RFC-020 D2：三个参考主题住在开发页的参考面板里，旧地址落到放大的面板并保留定位参数。
    projectResourcesFixture(admin); page = await renderApp(`${prefix}/${id}/settings?tab=${tab}`, admin ? '/admin' : '/projects');
    expect(page.path()).toBe(`${prefix}/${id}/dev-session`); expect(page.search()).toMatchObject(expected);
    await page.back(); expect(page.path()).toBe(admin ? '/admin' : '/projects');
  });
  // RFC-020 D2／D6：「项目与仓库」的家是项目设置 → 项目信息，「数据与存储」的家是开发页的数据面板；旧地址一次 replace 到位。
  test.each([
    ['settings?tab=resources&resource=overview&operation=stale.operation', 'settings', { tab: 'info' }], ['settings?tab=repository', 'settings', { tab: 'info' }],
    ['resources?section=project', 'settings', { tab: 'info' }], ['resources?section=data&proxy=leak', 'dev-session', { view: 'data' }],
    ['resources?section=guide&topic=environment', 'dev-session', { view: 'reference', panel: 'full', topic: 'guide', guide: 'environment' }],
  ])(`主题各归其家 ${prefix} / %s`, async (from, page_, expected) => {
    projectResourcesFixture(admin); page = await renderApp(`${prefix}/${id}/${from}`, admin ? '/admin' : '/projects');
    expect(page.path()).toBe(`${prefix}/${id}/${page_}`); expect(page.search()).toEqual(expected);
    await page.back(); expect(page.path()).toBe(admin ? '/admin' : '/projects');
  });
}

test('项目信息只读：仓库有真实链接，地址与服务身份直接可见，配额未知不冒充零，不混入接入参数', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/settings?tab=info`);
  expect(page.text()).toContain('尚未设置配额'); expect(page.text()).toContain('尚未选择服务套餐'); expect(page.text()).toContain('demo/demo'); expect(page.text()).toContain('https://preview.demo.test');
  expect(page.text()).not.toContain('X-User-Id'); expect(page.text()).not.toContain('CS_DATABASE_URL');
  expect(document.querySelector('a[href="https://repo.test/crew/demo"]')).not.toBeNull();
  // 只读组不画输入框；ID 在折叠的技术详情里。
  expect(document.querySelector('main form')).toBeNull();
  expect([...document.querySelectorAll('main details summary')].some((node) => node.textContent === '技术详情')).toBe(true);
});

test('订阅来自代码，保留订阅 ID 与投递路径，并指向当前项目 Manifest', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/resources?section=events&subscription=01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd`);
  expect(document.querySelector('tr[aria-current="true"]')?.textContent).toContain('source.changed');
  const links = [...document.querySelectorAll('a')];
  expect(links.find((link) => link.textContent?.includes('打开订阅声明'))?.getAttribute('href')).toContain('file=crewstation.yaml');
  expect(links.find((link) => link.textContent?.includes('查看事件投递'))?.getAttribute('href')).toContain('subscription=01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd');
  await page.click('查看事件投递'); expect(page.search()).toEqual({ tab: 'deliveries', subscription: '01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd' });
  await page.click('查看订阅'); expect(page.search()).toMatchObject({ view: 'reference', topic: 'events', subscription: '01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd' });
});

test('平台接入按主题展开，正确说明转发来源且保留环境名、路径、MCP、业务任务接口', async () => {
  projectResourcesFixture(true); page = await renderApp(`/admin/integrations/${id}/resources?section=guide&topic=environment`);
  expect([...document.querySelectorAll('details[open]')].some((node) => node.textContent?.includes('CS_API_BASE'))).toBe(true);
  for (const value of ['本项目覆盖', 'X-User-Id', 'CS_API_BASE', '/healthz', 'X-Trace-Id', 'APP_TOKEN', 'https://mcp.test', '/business-tasks']) expect(page.text()).toContain(value);
  await page.click('管理应用环境变量'); expect(page.path()).toBe(`/admin/integrations/${id}/settings`); expect(page.search()).toMatchObject({ tab: 'config', env: 'development' });
  expect(page.text()).not.toContain('应用展示');
});

test('参考面板主题切换使用同一参数与权限路径，错误留在当前主题可重试', async () => {
  const f = projectResourcesFixture(); f.state.fail = 'capabilities'; page = await renderApp(`/projects/${id}/resources?section=guide&topic=environment`);
  expect(page.text()).toContain('本主题暂不可用'); f.state.fail = ''; await page.click('重新读取资源'); expect(page.text()).toContain('CS_API_BASE');
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="资源主题"] [role="tab"]')].find((node) => node.textContent === '事件')!;
  await act(async () => tab.click()); await page.settle();
  // 换主题只留主题本身：上一主题的小节与定位参数不带过去。
  expect(page.search()).toEqual({ view: 'reference', panel: 'full', topic: 'events' }); expect(page.text()).toContain('source.changed');
});

test('资源参数不泄露无关上下文；主题与长度异常回到合理默认', () => {
  expect(parseResourceSearch({ section: 'data', operation: 'private', topic: 'mcp', env: 'production' })).toEqual({ section: 'data' });
  expect(parseResourceSearch({ section: 'guide', topic: 'bad' })).toEqual({ section: 'guide', topic: undefined });
  expect(parseResourceSearch({ section: 'bad', operation: 'x'.repeat(2049), proxy: 'bad\n' })).toEqual({ section: 'api', operation: undefined, proxy: undefined });
});
