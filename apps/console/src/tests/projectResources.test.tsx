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
    ['resources&resource=api&proxy=billing&operation=billing.get', { section: 'api', proxy: 'billing', operation: 'billing.get' }],
    ['resources&resource=events&subscription=sub-source', { section: 'events', subscription: 'sub-source' }],
    ['resources&resource=overview&operation=stale.operation', { section: 'project' }], ['repository', { section: 'project' }],
  ])(`旧设置迁移保留空间与参数 ${prefix} / %s`, async (tab, expected) => {
    projectResourcesFixture(admin); page = await renderApp(`${prefix}/${id}/settings?tab=${tab}`, admin ? '/admin' : '/projects');
    expect(page.path()).toBe(`${prefix}/${id}/resources`); expect(page.search()).toMatchObject(expected);
    await page.back(); expect(page.path()).toBe(admin ? '/admin' : '/projects');
  });
}

test('资源按目的分组：项目不混入接入参数；配额未知不冒充零，仓库有真实链接', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/resources?section=project`);
  expect(page.text()).toContain('尚未设置配额'); expect(page.text()).toContain('尚未选择服务套餐'); expect(page.text()).toContain('demo/demo');
  expect(page.text()).not.toContain('X-User-Id'); expect(page.text()).not.toContain('CS_DATABASE_URL');
  expect(document.querySelector('a[href="https://repo.test/crew/demo"]')).not.toBeNull();
  await page.click('数据与存储'); expect(page.search().section).toBe('data'); expect(page.text()).toContain('CS_DATABASE_URL');
  const dataLink = [...document.querySelectorAll('a')].find((link) => link.textContent?.includes('查看或申请数据访问'))!;
  expect(dataLink.getAttribute('href')).toContain(`/projects/${id}/dev-session?view=data`);
});

test('订阅来自代码，保留订阅 ID 与投递路径，并指向当前项目 Manifest', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/resources?section=events&subscription=sub-source`);
  expect(document.querySelector('tr[aria-current="true"]')?.textContent).toContain('source.changed');
  const links = [...document.querySelectorAll('a')];
  expect(links.find((link) => link.textContent?.includes('打开订阅声明'))?.getAttribute('href')).toContain('file=crewstation.yaml');
  expect(links.find((link) => link.textContent?.includes('查看事件投递'))?.getAttribute('href')).toContain('subscription=sub-source');
  await page.click('查看事件投递'); expect(page.search()).toEqual({ tab: 'deliveries', subscription: 'sub-source' });
  await page.click('查看订阅'); expect(page.search()).toMatchObject({ section: 'events', subscription: 'sub-source' });
});

test('平台接入按主题展开，正确说明转发来源且保留环境名、路径、MCP、业务任务接口', async () => {
  projectResourcesFixture(true); page = await renderApp(`/admin/integrations/${id}/resources?section=guide&topic=environment`);
  expect([...document.querySelectorAll('details[open]')].some((node) => node.textContent?.includes('CS_API_BASE'))).toBe(true);
  for (const value of ['本项目覆盖', 'X-User-Id', 'CS_API_BASE', '/healthz', 'X-Trace-Id', 'APP_TOKEN', 'https://mcp.test', '/business-tasks']) expect(page.text()).toContain(value);
  await page.click('管理应用环境变量'); expect(page.path()).toBe(`/admin/integrations/${id}/settings`); expect(page.search()).toMatchObject({ tab: 'config', env: 'development' });
  expect(page.text()).not.toContain('应用展示');
});

test('窄屏原生主题选择使用同一参数与权限路径，错误留在当前主题可重试', async () => {
  const f = projectResourcesFixture(); f.state.fail = 'capabilities'; page = await renderApp(`/projects/${id}/resources?section=data`);
  expect(page.text()).toContain('本主题暂不可用'); f.state.fail = ''; await page.click('重新读取资源'); expect(page.text()).toContain('CS_DATABASE_URL');
  const select = [...document.querySelectorAll('label')].find((node) => node.textContent?.startsWith('资源主题'))!.querySelector('select')!;
  await act(async () => { select.value = 'project'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  expect(page.search()).toEqual({ section: 'project' }); expect(page.text()).toContain('crew/demo');
});

test('资源参数不泄露无关上下文；主题与长度异常回到合理默认', () => {
  expect(parseResourceSearch({ section: 'data', operation: 'private', topic: 'mcp', env: 'production' })).toEqual({ section: 'data' });
  expect(parseResourceSearch({ section: 'guide', topic: 'bad' })).toEqual({ section: 'guide', topic: undefined });
  expect(parseResourceSearch({ section: 'bad', operation: 'x'.repeat(2049), proxy: 'bad\n' })).toEqual({ section: 'api', operation: undefined, proxy: undefined });
});
