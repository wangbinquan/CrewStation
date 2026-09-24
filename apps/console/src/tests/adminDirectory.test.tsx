import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { adminDirectoryFixture } from './adminDirectoryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

/** 页面某处列出的管理项目名（链接文字），按出现顺序；避免「管理项目 1」按子串也命中「管理项目 10」。 */
const names = (root: ParentNode | null = document.querySelector('main')) => [...root?.querySelectorAll('a') ?? []].map((a) => a.textContent ?? '').filter((text) => text.startsWith('管理项目'));
const card = (title: string) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === title)!;

test('管理总览显示三类真实待办，各取五条；失败来源保持错误，入口只导航', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin');
  expect(page.text()).toContain('待处理事项'); expect(page.text()).toContain(f.apiRequests[0]!.operationId);
  expect(page.text()).toContain('生产配置尚未补齐');
  expect(page.text()).not.toContain(f.apiRequests[5]!.operationId);
  const requests = f.calls.filter((c) => c.url.pathname.endsWith('/page'));
  // RFC-018：出站待办已删除；2026-09-24 起开通失败按数字人与接入容器拆成两张卡，各读各的。
  expect(requests).toHaveLength(3); expect(requests.every((c) => c.url.searchParams.get('limit') === '5')).toBe(true);
  expect(requests.filter((c) => c.url.pathname === '/v1/projects/page').map((c) => c.url.searchParams.get('kind')).sort()).toEqual(['APIProxy,EventProducer', 'DigitalWorker']);
  expect(page.text()).not.toContain('待审批出站申请');
  expect(f.calls.some((c) => c.url.pathname.includes('egress'))).toBe(false);
  expect(f.calls.some((c) => c.url.pathname === '/v1/projects')).toBe(false);
  await page.click(f.apiRequests[0]!.operationId); expect(page.path()).toBe('/admin/requests');
  expect(page.search()).toMatchObject({ state: 'pending', projectId: f.projects[0]!.project.id }); expect(f.writes()).toHaveLength(0);
});

test('API 待办离线时保留错误，不用 0 覆盖', async () => {
  const f = adminDirectoryFixture(); f.state.apiError = true; page = await renderApp('/admin');
  expect(page.text()).toContain('API 待办离线'); expect(page.text()).toContain('生产配置尚未补齐');
  expect(f.writes()).toHaveLength(0);
});

test('开通失败分两张卡：各列自己那一类，数字人的入口去项目管理，接入容器的去能力接入', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin');
  // 前 12 个项目开通失败：数字人是 0、3、6、9；接入容器是其余 8 个，卡上只列前 5 个。
  expect(names(card('数字人开通失败'))).toEqual(['管理项目 0', '管理项目 3', '管理项目 6', '管理项目 9']);
  expect(card('数字人开通失败').textContent).toContain('本次显示 4 项');
  expect(names(card('接入容器开通失败'))).toEqual(['管理项目 1', '管理项目 2', '管理项目 4', '管理项目 5', '管理项目 7']);
  expect(card('接入容器开通失败').textContent).toContain('本次显示 5 项，还有更多');
  await page.click('管理项目 4'); expect(page.path()).toBe(`/admin/projects/${f.projects[4]!.project.id}/provisioning`);
  await page.navigate('/admin'); await page.click('查看开通失败的数字人');
  expect([page.path(), page.search()]).toEqual(['/admin/projects', expect.objectContaining({ state: 'failed' })]);
  expect(names()).toEqual(['管理项目 0', '管理项目 3', '管理项目 6', '管理项目 9']);
  await page.navigate('/admin'); await page.click('查看开通失败的接入容器');
  expect([page.path(), page.search()]).toEqual(['/admin/capabilities', expect.objectContaining({ tab: 'integrations', state: 'failed' })]);
  expect(names()).toEqual(['管理项目 1', '管理项目 2', '管理项目 4', '管理项目 5', '管理项目 7', '管理项目 8', '管理项目 10', '管理项目 11']);
  expect(f.writes()).toHaveLength(0);
});

test('项目管理只列数字人：只按 DigitalWorker 读、默认分页 20，没有类型筛选、类型列与新建接入容器', async () => {
  // 作者 2026-09-24：项目管理与能力接入两处都列出接入容器，项目管理里不该有它们，也不要「新建接入容器」。
  const f = adminDirectoryFixture({ count: 66 }); page = await renderApp('/admin/projects');
  expect(page.text()).toContain('项目管理');
  const query = f.calls.find((c) => c.url.pathname === '/v1/projects/page')!.url.searchParams;
  expect(query.get('limit')).toBe('20'); expect(query.get('kind')).toBe('DigitalWorker');
  expect(f.calls.some((c) => c.url.pathname === '/v1/projects')).toBe(false);
  // 66 个项目里下标是 3 的倍数的 22 个是数字人：第一页是 0、3 … 57，接入容器一个都不出现。
  expect(names()).toEqual(Array.from({ length: 20 }, (_, i) => `管理项目 ${i * 3}`));
  expect(document.querySelector('select[aria-label="项目类型"]')).toBeNull();
  expect([...document.querySelectorAll('main th')].map((th) => th.textContent)).toEqual(['项目', '负责人', '开通状态', '管理操作']);
  expect(page.text()).toContain('新建数字人'); expect(page.text()).not.toContain('新建接入容器');
  await page.click('下一页'); expect(page.search().cursor).toBe('20'); expect(names()).toEqual(['管理项目 60', '管理项目 63']);
  await page.back(); expect(page.search().cursor).toBeUndefined(); expect(names()[0]).toBe('管理项目 0'); expect(f.writes()).toHaveLength(0);
});

async function field(label: string, value: string) {
  const node = document.querySelector<HTMLInputElement | HTMLSelectElement>(`input[aria-label="${label}"], select[aria-label="${label}"]`)!;
  await act(async () => { node.focus(); const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}

test('项目管理的搜索与开通状态在 URL 保留、改条件回第一页；旧链接带的类型被忽略', async () => {
  const f = adminDirectoryFixture({ count: 66 }); page = await renderApp('/admin/projects?cursor=20&kind=APIProxy');
  // 改版前的链接可能带 kind=APIProxy：项目管理照旧只按数字人读，地址上也不留这个条件。
  expect(page.search().kind).toBeUndefined();
  await field('名称或标识', 'managed-2'); await field('开通状态', 'active'); await page.click('查询项目');
  expect(page.search()).toMatchObject({ q: 'managed-2', state: 'active' }); expect(page.search().cursor).toBeUndefined();
  expect(f.calls.filter((c) => c.url.pathname === '/v1/projects/page').every((c) => c.url.searchParams.get('kind') === 'DigitalWorker')).toBe(true);
  // managed-2 与 managed-20…29 里的数字人：21、24、27。
  expect(names()).toEqual(['管理项目 21', '管理项目 24', '管理项目 27']);
});

test('接入容器目录保留类型筛选：只在两种接入类型里筛，项目进管理空间的项目页', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/capabilities?tab=integrations&kind=DigitalWorker');
  const last = () => f.calls.filter((c) => c.url.pathname === '/v1/projects/page').at(-1)!.url.searchParams;
  expect(page.search().kind).toBeUndefined(); expect(last().get('kind')).toBe('APIProxy,EventProducer'); expect(names()).not.toContain('管理项目 0');
  expect([...document.querySelectorAll<HTMLOptionElement>('select[aria-label="项目类型"] option')].map((option) => option.value)).toEqual(['', 'APIProxy', 'EventProducer']);
  expect([...document.querySelectorAll('main th')].map((th) => th.textContent)).toEqual(['项目', '项目类型', '负责人', '开通状态', '管理操作']);
  expect(page.text()).toContain('新建接入容器'); expect(page.text()).not.toContain('新建数字人');
  await field('名称或标识', 'managed-2'); await field('项目类型', 'APIProxy'); await field('开通状态', 'active'); await page.click('查询项目');
  expect(page.search()).toMatchObject({ tab: 'integrations', q: 'managed-2', kind: 'APIProxy', state: 'active' });
  expect(last().get('kind')).toBe('APIProxy'); expect(names()).toEqual(['管理项目 22', '管理项目 25', '管理项目 28']);
  await page.click('管理项目 22'); expect(page.path()).toBe(`/admin/integrations/${f.projects[22]!.project.id}`);
});

test('待办独立加载、空态与错误不混淆，失败来源单独重读后恢复', async () => {
  const f = adminDirectoryFixture(); let release!: () => void; f.state.holdApi = new Promise<void>((r) => { release = r; });
  page = await renderApp('/admin');
  const card = () => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === '待审批 API 申请')!;
  expect(card().textContent).toContain('数量未确认'); expect(card().textContent).not.toContain('当前没有待处理事项');
  f.state.apiError = true; await act(async () => release()); await page.settle(); expect(card().textContent).toContain('API 待办离线');
  expect(card().textContent).not.toContain('本次显示 0 项'); f.state.holdApi = undefined; f.state.apiError = false;
  await page.reread(); expect(card().textContent).toContain(f.apiRequests[0]!.operationId); expect(card().textContent).toContain('还有更多');
  f.apiRequests.length = 0; await page.reread(); expect(card().textContent).toContain('当前没有待处理事项'); expect(card().textContent).toContain('本次显示 0 项');
});

test('管理目录读取失败保留材料但暂停管理动作，无效回执不冒充空目录', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin/projects'); f.state.projectError = true;
  await page.reread(); expect(page.text()).toContain('管理项目目录离线'); expect(page.text()).toContain('显示上次读取的项目');
  expect(document.querySelectorAll('a[href$="/provisioning"]').length).toBe(0); expect(page.text()).not.toContain('本页 0 个项目');
  // 第一页只有数字人，其中开通失败的是 0、3、6、9。
  f.state.projectError = false; await page.reread(); expect(document.querySelectorAll('a[href$="/provisioning"]').length).toBe(4);
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
  await page.reread(); expect(page.text()).toContain('管理身份离线');
  expect([...document.querySelectorAll('a')].filter((node) => !node.closest('[hidden]')).some((node) => node.textContent?.includes('管理项目 0'))).toBe(false);
  f.state.identityError = false; await page.reread(); expect(page.text()).toContain('管理项目 0');
  // 定时重读先核对身份再读目录（useAdminRead）：回到前台触发的就是这一条，身份撤销后不再读目录。
  f.state.admin = false; const before = f.calls.filter((c) => c.url.pathname === '/v1/projects/page').length;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page.settle(); expect(page.text()).toContain('仅平台管理员可见'); expect(page.text()).not.toContain('管理项目 0');
  expect(f.calls.filter((c) => c.url.pathname === '/v1/projects/page')).toHaveLength(before); expect(f.writes()).toHaveLength(0);
});

test('例行重读不改界面：在途也不把入口换成纯文本（2026-09-23 起没有手动刷新）', async () => {
  const f = adminDirectoryFixture(); page = await renderApp('/admin');
  const entry = () => [...document.querySelectorAll('a, span')].find((node) => node.textContent === f.apiRequests[0]!.operationId)!;
  expect(entry().tagName).toBe('A');
  // 回到前台走的是同一条例行重读：在途也不把入口换成纯文本。
  let release!: () => void; f.state.holdApi = new Promise<void>((r) => { release = r; });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page.settle();
  const reads = () => f.calls.filter((c) => c.url.pathname === '/v1/api-requests/page').length;
  expect(reads()).toBe(2); expect(entry().tagName).toBe('A');
  f.state.holdApi = undefined; await act(async () => release()); await page.settle(); expect(entry().tagName).toBe('A');
});
