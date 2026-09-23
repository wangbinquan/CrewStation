import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { parseResourceSearch } from '../shared/project/resourceSearch';
import { renderApp } from './renderApp';
import { projectResourcesFixture, resourcesProjectId as id, resourcesServiceId } from './projectResourcesFixture';
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const topicTab = () => document.querySelector('[role="tablist"][aria-label="资源主题"] [aria-selected="true"]')?.textContent;
async function chooseTopic(label: string) {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="资源主题"] [role="tab"]')].find((node) => node.textContent === label)!.click()); await page!.settle();
}

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

test('项目信息只读：最上面是直接展开的项目信息卡，仓库有真实链接，地址与服务身份直接可见，配额未知不冒充零，不混入接入参数', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/settings?tab=info`);
  expect(page.text()).toContain('尚未设置配额'); expect(page.text()).toContain('尚未选择服务套餐'); expect(page.text()).toContain('demo/demo'); expect(page.text()).toContain('https://preview.demo.test');
  expect(page.text()).not.toContain('X-User-Id'); expect(page.text()).not.toContain('CS_DATABASE_URL');
  expect(document.querySelector('a[href="https://repo.test/crew/demo"]')).not.toBeNull();
  // 只读组不画输入框。
  expect(document.querySelector('main form')).toBeNull();
  // 2026-09-23 作者裁定：原先折叠的「技术详情」就是项目信息，作为这一组最上面的卡片直接展开（RFC-020 design §7 修订）。
  const titles = [...document.querySelectorAll('main section > header > h2')];
  expect(titles.slice(0, 2).map((node) => node.textContent)).toEqual(['项目信息', '源码仓库']);
  const card = titles[0]!.closest('section')!;
  expect(card.closest('details') === null).toBe(true);
  expect([...card.querySelectorAll('dt')].map((node) => node.textContent)).toEqual(['项目 ID', '服务 ID', '命名空间']);
  expect([...card.querySelectorAll('dd')].map((node) => node.textContent)).toEqual([id, resourcesServiceId, 'cs-demo']);
});

test('开通未完成时项目信息卡照样在最上面，服务 ID 用「—」占位，没有仓库卡并说明原因', async () => {
  const f = projectResourcesFixture(); f.state.noService = true; page = await renderApp(`/projects/${id}/settings?tab=info`);
  const titles = [...document.querySelectorAll('main section > header > h2')];
  expect(titles[0]?.textContent).toBe('项目信息'); expect(titles.map((node) => node.textContent)).not.toContain('源码仓库');
  expect([...titles[0]!.closest('section')!.querySelectorAll('dd')].map((node) => node.textContent)).toEqual([id, '—', 'cs-demo']);
  expect(page.text()).toContain('项目尚未开通服务'); expect(f.calls.some((path) => path.endsWith('/repository'))).toBe(false);
});

test('订阅来自代码，保留订阅 ID 与投递路径，并指向当前项目 Manifest', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/resources?section=events&subscription=01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd`);
  // 2026-09-23：订阅是两行列表的一行（类型 → 处理路径），地址里的订阅标为当前行。
  expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('source.changed');
  expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('/on-source');
  const links = [...document.querySelectorAll('a')];
  expect(links.find((link) => link.textContent?.includes('打开订阅声明'))?.getAttribute('href')).toContain('file=crewstation.yaml');
  // RFC-020 §7：事件段顶部一行投递摘要即投递页入口，带着当前订阅。
  expect(links.find((link) => link.textContent?.includes('最近投递'))?.getAttribute('href')).toContain('subscription=01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd');
  await page.click('最近投递'); expect(page.search()).toEqual({ tab: 'deliveries', subscription: '01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd' });
  await page.click('查看订阅'); expect(page.search()).toMatchObject({ view: 'reference', topic: 'events', subscription: '01a0bf5d-8f4b-7b9c-8c07-a2ef94c840cd' });
});

test('平台约定按代码怎么用它分到四类：运行环境、接收事件、Agent 工具、调用接口，各自保留原来的全部字段', async () => {
  projectResourcesFixture(true); page = await renderApp(`/admin/integrations/${id}/resources?section=guide&topic=environment`);
  expect(page.search()).toMatchObject({ topic: 'guide', guide: 'environment' }); expect(topicTab()).toBe('运行环境');
  for (const value of ['本项目覆盖', 'X-User-Id', 'CS_API_BASE', '/healthz', 'APP_GREETING', 'APP_TOKEN']) expect(page.text()).toContain(value);
  // 旧的「平台接入」折叠块没有了：没有 <details>，也不再用代码内部键名当标签。
  expect(document.querySelector('[role="tabpanel"] details')).toBeNull(); expect(page.text()).not.toContain('identityHeaders');
  await chooseTopic('接收事件'); expect(page.text()).toContain('X-Trace-Id');
  await chooseTopic('Agent 工具'); expect(page.text()).toContain('https://mcp.test'); expect(page.text()).toContain('x-cs-dev-session-token');
  await chooseTopic('调用接口'); expect(page.text()).toContain('/business-tasks'); expect(page.text()).toContain('Start a business task');
  await chooseTopic('运行环境'); await page.click('管理应用环境变量'); expect(page.path()).toBe(`/admin/integrations/${id}/settings`); expect(page.search()).toMatchObject({ tab: 'config', env: 'development' });
  expect(page.text()).not.toContain('应用展示');
});

test('旧链接里「平台接入」的 MCP 与业务任务小节落到它们现在的家', async () => {
  projectResourcesFixture(); page = await renderApp(`/projects/${id}/resources?section=guide&topic=mcp`);
  expect(topicTab()).toBe('Agent 工具'); expect(page.text()).toContain('https://mcp.test');
  page.unmount(); page = await renderApp(`/projects/${id}/resources?section=guide&topic=tasks`);
  expect(topicTab()).toBe('调用接口'); expect(page.text()).toContain('/business-tasks');
});

test('参考面板主题切换使用同一参数与权限路径，错误留在当前主题可重试', async () => {
  const f = projectResourcesFixture(); f.state.fail = 'capabilities'; page = await renderApp(`/projects/${id}/resources?section=guide&topic=environment`);
  expect(page.text()).toContain('本主题暂不可用'); f.state.fail = ''; await page.click('重新读取资源'); expect(page.text()).toContain('CS_API_BASE');
  await chooseTopic('接收事件');
  // 换主题只留主题本身：上一主题的小节与定位参数不带过去。
  expect(page.search()).toEqual({ view: 'reference', panel: 'full', topic: 'events' }); expect(page.text()).toContain('source.changed');
});

test('资源参数不泄露无关上下文；主题与长度异常回到合理默认', () => {
  expect(parseResourceSearch({ section: 'data', operation: 'private', topic: 'mcp', env: 'production' })).toEqual({ section: 'data' });
  expect(parseResourceSearch({ section: 'guide', topic: 'bad' })).toEqual({ section: 'guide', topic: undefined });
  expect(parseResourceSearch({ section: 'bad', operation: 'x'.repeat(2049), proxy: 'bad\n' })).toEqual({ section: 'api', operation: undefined, proxy: undefined });
});
