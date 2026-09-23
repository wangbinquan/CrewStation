import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { parseOperationsSearch } from '../shared/project/operationsSearch';
import { parseSettingsSearch } from '../shared/project/settingsSearch';
import { renderApp } from './renderApp';
import { consoleStyles, sourceAt } from './sourceScan';

const originalFetch = globalThis.fetch;
const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', taskId = '01a0bf5d-8f4b-7e52-8b45-4a547fd10e4f', releaseId = '01a0bf5d-8f4b-762d-81e1-f95f4dd57c2d', traceId = 'e'.repeat(32);
const project = { id: projectId, serviceId, name: '团队知识助理', slug: 'team-knowledge', kind: 'DigitalWorker', state: 'active', namespace: 'cs-team-knowledge', createdAt: '2026-09-13T01:00:00.000Z' };
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(logItems?: unknown[], admin = false) {
  const calls: Array<{ url: URL; method: string }> = [];
  let logFailure = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'http://localhost');
    calls.push({ url, method: init?.method ?? 'GET' });
    let status = 200, body: unknown = { items: [] };
    if (url.pathname === '/v1/me') body = { id: 'user', name: '小林', platformRole: (admin) ? 'admin' : 'developer', isAdmin: admin, memberships: [{ projectId, role: 'owner' }] };
    else if (url.pathname === `/v1/projects/${projectId}`) body = project;
    else if (url.pathname === `/v1/projects/01a0bf5d-8f4b-7927-8d04-a341edee681a`) body = { ...project, id: '01a0bf5d-8f4b-70bd-8586-401e32bbc3b4', name: '另一个应用', slug: 'another-app' };
    else if (url.pathname === `/v1/services/${serviceId}`) body = { id: serviceId, projectId };
    else if (url.pathname.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    else if (url.pathname.endsWith('/health')) body = { items: [{ slot: 'prod', state: 'unknown', readyReplicas: 0, replicas: 1, restarts: 2, lastTransitionAt: '2026-09-13T01:00:00.000Z' }] };
    else if (url.pathname.endsWith('/logs') && logFailure) { status = 503; body = { error: 'unavailable', message: '读取 Pod 日志失败' }; }
    else if (url.pathname.endsWith('/logs')) body = { items: logItems ?? [{ ts: '2026-09-13T01:01:00.000Z', source: 'build', stream: 'stderr', message: 'build fixture line' }] };
    else if (url.pathname.includes('/openapi')) { status = 503; body = { error: 'unavailable', message: '文档暂不可用' }; }
    else if (url.pathname.endsWith('/operations')) body = { items: [
      { id: '01a0bf5d-8f4b-7735-8981-22e6031d8202', proxyId: '01a0bf5d-8f4b-7e4c-802d-e2023d65b4fe', proxy: 'billing', method: 'GET', path: '/invoices/{id}', openPolicy: 'default', granted: true },
      { id: '01a0bf5d-8f4b-775b-84c1-bbc06f634e58', proxyId: '01a0bf5d-8f4b-75c6-8ee5-a606417e1b8d', proxy: 'docs', method: 'GET', path: '/articles/{id}', openPolicy: 'targeted', granted: false },
    ] };
    else if (url.pathname.endsWith('/deliveries')) body = { items: [
      { id: 'delivery-a', eventId: 'event-a', subscriptionId: 'sub-a', eventType: 'git.push', state: 'delivered', attempts: 1, traceId },
      { id: 'delivery-b', eventId: 'event-b', subscriptionId: 'sub-b', eventType: 'git.issue', state: 'delivered', attempts: 1, traceId },
    ] };
    else if (url.pathname.endsWith('/subscriptions')) body = { items: [{ id: 'sub-a', serviceId, eventType: 'git.push', handlerPath: '/events', state: 'active' }] };
    else if (url.pathname.endsWith(`/traces/${traceId}`)) body = { traceId, tasks: [{ taskId, kind: 'dev-session', createdAt: '2026-09-13T01:00:00.000Z' }], subtasks: [], sessionIds: [], events: [{ at: '2026-09-13T01:01:00.000Z', type: 'runner.connected', taskId }] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, failLogs: () => { logFailure = true; } };
}

async function input(node: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    node.focus();
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.settle();
}

test('资源说明读取失败展示原因，并在原地自动重读，不需要离开设置页', async () => {
  fixture(); const fallback = globalThis.fetch; let attempts = 0;
  globalThis.fetch = (async (raw, init) => String(raw).endsWith('/capabilities')
    ? Response.json({ error: 'unavailable', message: ++attempts === 1 ? '资源查询失败' : '资源查询仍不可用' }, { status: 503 })
    : fallback(raw, init)) as typeof fetch;
  page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=overview`);
  expect(page.text()).toContain('资源查询失败'); expect(attempts).toBe(1);
  // 2026-09-23 裁定：没有「重新读取资源」按钮，5xx 由 useApiQuery 每 15 秒自动重读；reread 模拟一次自动重读。
  expect(page.text()).toContain('稍后会自动重新读取'); expect(page.text()).not.toContain('重新读取资源');
  await page.reread();
  expect(attempts).toBe(2); expect(page.text()).toContain('资源查询仍不可用');
  // 旧「约定与资源」地址现在落到项目设置的「项目信息」（RFC-020 D2／D6）。
  expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.search().tab).toBe('info');
});

test('资源说明结构不完整时给出会自动重读的错误，不让整个设置页崩溃', async () => {
  fixture();
  page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=overview`);
  expect(page.text()).toContain('资源说明返回不完整');
  expect(page.text()).toContain('稍后会自动重新读取');
  await page.click('项目设置'); await page.click('成员与角色');
  expect(page.search().tab).toBe('members');
});

describe('五个项目入口与旧链接兼容', () => {
  test('项目名与 slug 取实际项目，五项生命周期顺序导航；概览页头请求一次仓库地址，不请求配额与形态之外的详情', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}`);
    const links = [...document.querySelectorAll('[aria-label="项目页面"] a')];
    // RFC-020 D2：「开发资源」不再是入口，左栏顺序即生命周期。
    expect(links.map((link) => link.textContent)).toEqual(['概览', '开发', '发布与上线', '运行与诊断', '项目设置']);
    expect(page.text()).toContain('团队知识助理'); expect(page.text()).toContain('team-knowledge');
    expect(document.querySelector('header.bar')?.textContent).not.toContain(projectId);
    // 页头的仓库链接跟着摘要走：这份夹具没有摘要，就不该去读仓库或成员。
    expect(f.calls.some((call) => call.url.pathname.endsWith('/members') || call.url.pathname.endsWith('/repository'))).toBe(false);
    await page.click('项目设置'); expect(page.search()).toMatchObject({ tab: 'config', env: 'development' });
  });

  test('开发会话及其子页的左栏与其他项目页同宽，只有正文收紧密度', async () => {
    fixture(); page = await renderApp(`/projects/${projectId}`);
    const shell = (): string => document.querySelector('.shell')!.className;
    const other = shell();
    // 开发页曾把 --cs-nav-width 改写成 156px，左栏因此比其他页签窄一截，进出开发会话时整条左栏跳一下。
    await page.navigate(`/projects/${projectId}/dev-session`);
    expect(shell()).toBe(other);
    expect(document.querySelector('main')!.className).toContain('compact');
    await page.navigate(`/projects/${projectId}/dev-session/conversations`);
    expect(shell()).toBe(other);
    // 宽度只能有一个来源：任何页面级改写都会让这条红，而不是等实机看出来。
    expect(consoleStyles().filter((file) => /--cs-nav-width\s*:/.test(file.code)).map((file) => file.path)).toEqual(['app/theme/tokens.css']);
  });

  test('内容区没有最大宽度：全部页面随窗口铺满', () => {
    // 2026-09-22 作者裁定全部页面去掉 1200px 上限（RFC-019 原型评审时提出，回填 RFC-003 §6）：令牌不能再出现，外壳的 .content 也不能再写 max-width 声明。
    const styles = consoleStyles();
    expect(styles.filter((file) => /--cs-content-max-width/.test(file.code)).map((file) => file.path)).toEqual([]);
    expect(/^\s*max-width\s*:/m.test(sourceAt(styles, 'app/layout/AppShell.module.css').code)).toBe(false);
  });

  test('旧日志深链接 replace，完整发布与时间条件实际进入接口；返回回到旧链接之前', async () => {
    const f = fixture(), since = '2026-09-13T01:00:00.000Z';
    page = await renderApp(`/projects/${projectId}/logs?source=migration&releaseId=${releaseId}&since=${since}&limit=700`, '/projects');
    expect(page.path()).toBe(`/projects/${projectId}/operations`);
    const query = f.calls.find((call) => call.url.pathname.endsWith('/logs'))!.url.searchParams;
    expect(Object.fromEntries(query)).toEqual({ source: 'migration', releaseId, since, limit: '700' });
    expect(page.text()).toContain(releaseId); expect(page.text()).toContain(since);
    await page.back(); expect(page.path()).toBe('/projects');
  });

  test('日志可清除任务上下文，切来源清除不适用的参数；全部槽不会回成 prod', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/operations?tab=logs&source=dev-session&taskId=${taskId}`);
    expect(f.calls.some((call) => call.url.searchParams.get('taskId') === taskId)).toBe(true);
    await page.click(`taskId: ${taskId}`); expect(page.search().taskId).toBeUndefined();
    const source = document.querySelector<HTMLSelectElement>('select option[value="dev-session"]')!.parentElement as HTMLSelectElement;
    await input(source, 'slot');
    const slot = document.querySelector<HTMLSelectElement>('select option[value="preview"]')!.parentElement as HTMLSelectElement;
    await input(slot, ''); expect(page.search().slot).toBe('all');
    const last = f.calls.filter((call) => call.url.pathname.endsWith('/logs')).at(-1)!;
    expect(last.url.searchParams.has('slot')).toBe(false); expect(last.url.searchParams.has('taskId')).toBe(false);
  });

  test('完整日志页面接收未知时间而不崩溃，过滤后保留接口顺序与精确发布条件', async () => {
    const f = fixture([
      { ts: '2026-09-14T13:59:54.295Z', source: 'migration', stream: 'combined', message: 'migration known' },
      { source: 'migration', stream: 'combined', message: 'migration unknown' },
    ]);
    page = await renderApp(`/projects/${projectId}/operations?tab=logs&source=migration&releaseId=${releaseId}`);
    // useLogFeed 曾对每条 ts 调 localeCompare；未知时间必须贯穿整个页面，不能只在 LogRow 兼容。
    expect([...document.querySelectorAll('[role="log"] .message')].map((node) => node.textContent)).toEqual(['migration known', 'migration unknown']);
    expect(page.text()).toContain('时间未知');
    expect(f.calls.filter((call) => call.url.pathname.endsWith('/logs')).every((call) => call.url.searchParams.get('releaseId') === releaseId)).toBe(true);
    await input(document.querySelector<HTMLInputElement>('input[placeholder="在本页内过滤"]')!, 'unknown');
    expect([...document.querySelectorAll('[role="log"] .message')].map((node) => node.textContent)).toEqual(['migration unknown']);
  });

  test('健康状态可定位对应槽日志，查询失败保留错误而不显示正常', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/operations?tab=health`);
    f.failLogs(); await page.click('查看此版本日志');
    expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'prod' });
    expect(page.text()).toContain('读取 Pod 日志失败'); expect(page.text()).not.toContain('build fixture line');
  });

  test('旧接口链接保留代理与操作并实际定位，清除后恢复完整目录', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/catalog?proxy=01a0bf5d-8f4b-7e4c-802d-e2023d65b4fe&operation=01a0bf5d-8f4b-7735-8981-22e6031d8202`);
    // RFC-020 D2：接口目录住在开发页的参考面板里，旧链接落到放大的参考面板。
    expect(page.path()).toBe(`/projects/${projectId}/dev-session`); expect(page.search()).toMatchObject({ view: 'reference', panel: 'full', topic: 'api', proxy: '01a0bf5d-8f4b-7e4c-802d-e2023d65b4fe', operation: '01a0bf5d-8f4b-7735-8981-22e6031d8202' });
    expect(page.text()).toContain('/invoices/{id}'); expect(page.text()).not.toContain('/articles/{id}');
    expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('/invoices/{id}'); expect(document.querySelector('aside[aria-label="操作详情"]')?.textContent).toContain('GET /invoices/{id}');
    expect(page.text()).not.toContain('管理员模式');
    await page.click('查看全部接口'); expect(page.search().operation).toBeUndefined(); expect(page.text()).toContain('/articles/{id}');
    expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('旧能力链接保留 API 操作，不存在的操作不偷偷展示其他操作', async () => {
    fixture(); page = await renderApp(`/projects/${projectId}/capabilities?operation=missing.operation`);
    expect(page.search()).toMatchObject({ view: 'reference', topic: 'api', operation: 'missing.operation' });
    // RFC-020：放大形态里 operation 是选中而不是筛选——表照常列出目录，详情栏如实说明没有这个操作，没有任何一行被选中。
    expect(page.text()).toContain('目录里没有操作 missing.operation'); expect(document.querySelector('tr[aria-current="true"]')).toBeNull(); expect(page.text()).toContain('/invoices/{id}');
  });

});

describe('诊断、订阅与配置的上下文', () => {
  test('同路径切到生产配置后，空间往返恢复最新分组', async () => {
    const f = fixture(undefined, true); page = await renderApp(`/projects/${projectId}/config`);
    await page.click('生产'); expect(page.search().env).toBe('production');
    await page.click('平台管理'); await page.click('项目开发');
    // 同一 pathname 的 query 也必须更新返回位置，不能沿用开发组或默认成员分类。
    expect(page.path()).toBe(`/projects/${projectId}/settings`);
    expect(page.search()).toEqual({ tab: 'config', env: 'production' });
    expect([...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((node) => node.textContent)).toContain('生产');
    expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('空间往返保留日志发布与时间筛选，回程仍读取原版本', async () => {
    const f = fixture(undefined, true), since = '2026-09-13T01:00:00.000Z';
    page = await renderApp(`/projects/${projectId}/logs?source=migration&releaseId=${releaseId}&since=${encodeURIComponent(since)}&limit=700`);
    await page.click('平台管理'); await page.click('项目开发');
    // 原实现回到 operations 默认健康页，丢掉用于排查单次发布的完整条件。
    expect(page.path()).toBe(`/projects/${projectId}/operations`);
    expect(page.search()).toEqual({ tab: 'logs', source: 'migration', releaseId, since, limit: 700 });
    const lastLogRequest = f.calls.filter((call) => call.url.pathname.endsWith('/logs')).at(-1)!;
    expect(Object.fromEntries(lastLogRequest.url.searchParams)).toEqual({ source: 'migration', releaseId, since, limit: '700' });
    expect(page.text()).toContain('build fixture line'); expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('同一设置路由切换项目会换上下文，上一项目草稿不进入新项目', async () => {
    fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await page.click('新增变量');
    await input(document.querySelector<HTMLInputElement>('input[placeholder="DATABASE_URL"]')!, 'OLD_PROJECT_DRAFT');
    await page.requestNavigate(`/projects/01a0bf5d-8f4b-7927-8d04-a341edee681a/settings?tab=config`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); await page.click('放弃输入并离开');
    expect(page.text()).toContain('另一个应用'); expect(page.text()).not.toContain('团队知识助理');
    expect([...document.querySelectorAll<HTMLInputElement>('input')].some((node) => node.value === 'OLD_PROJECT_DRAFT')).toBe(false);
  });
  test('投递的订阅上下文可到开发资源定位；trace 点击使用项目作用域接口', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/events?subscription=sub-a`);
    expect(page.search()).toMatchObject({ tab: 'deliveries', subscription: 'sub-a' });
    expect(page.text()).toContain('最近 50 条'); expect(page.text()).toContain('git.push'); expect(page.text()).not.toContain('git.issue');
    await page.click('查看订阅'); expect(page.search()).toMatchObject({ view: 'reference', topic: 'events', subscription: 'sub-a' });
    expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('git.push');
    await page.back(); await page.click(traceId);
    expect(page.search()).toEqual({ tab: 'trace', traceId }); expect(page.text()).toContain('runner.connected');
    expect(f.calls.some((call) => call.url.pathname === `/v1/projects/${projectId}/traces/${traceId}`)).toBe(true);
    expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('配置默认开发组；切环境与返回保留两组各自草稿，不自动保存', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/config`);
    expect(page.search()).toMatchObject({ tab: 'config', env: 'development' });
    expect(document.querySelector('[aria-label="项目页面"] a[aria-current="page"]')?.textContent).toBe('项目设置');
    // 2026-09-23 起新增变量是弹窗：关窗保留草稿；切到另一组时这一组连同它的弹窗藏起，草稿仍在。
    const draftName = () => document.querySelector<HTMLInputElement>('dialog[open] input[placeholder="DATABASE_URL"]');
    await page.click('新增变量'); await input(draftName()!, 'DEV_DRAFT'); await page.click('取消'); await page.click('生产');
    expect(page.search().env).toBe('production');
    await page.click('新增变量'); await input(draftName()!, 'PROD_DRAFT'); await page.back();
    expect(page.search().env).toBe('development'); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
    await page.click('新增变量'); expect(draftName()?.value).toBe('DEV_DRAFT'); await page.click('取消');
    await page.click('生产'); expect(draftName()?.value).toBe('PROD_DRAFT');
    expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('调用链格式约束首屏出现，错误输入不查询；用户确认有效 ID 才查', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/operations?tab=trace&traceId=invalid`);
    expect(page.text()).toContain('32 位十六进制');
    await input(document.querySelector<HTMLInputElement>('input[aria-invalid]')!, 'invalid-trace');
    await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.focus());
    await page.click('查询调用链');
    const invalidField = document.querySelector<HTMLInputElement>('input[aria-invalid="true"]')!;
    expect(invalidField).not.toBeNull(); expect(invalidField.value).toBe('invalid-trace');
    // 实机点击提交后焦点仍留在按钮上，错误字段虽然标红却不能直接继续更正。
    expect(document.activeElement === invalidField).toBe(true);
    expect(document.getElementById(invalidField.getAttribute('aria-errormessage')!)?.textContent).toContain('32 位小写十六进制');
    expect(f.calls.some((call) => call.url.pathname.includes('/traces/'))).toBe(false);
    await input(document.querySelector<HTMLInputElement>('input[aria-invalid]')!, traceId); await page.click('查询调用链');
    expect(page.text()).toContain('runner.connected'); expect(page.search().traceId).toBe(traceId);
  });
});

// 2026-09-23 作者当面裁定：健康与形态重新分成两个页签，部署与运行形态在最前、也是默认（修订 RFC-020 D3）；合并期间的 tab=status 落到形态。
test('运行与诊断六个页签：部署与运行形态在最前并默认打开，健康卡只在健康状态页签；旧的 tab=status 换成形态', async () => {
  fixture(); page = await renderApp(`/projects/${projectId}/operations`);
  const tabs = () => [...document.querySelectorAll('[role="tablist"][aria-label="运行与诊断"] [role="tab"]')];
  expect(tabs().map((tab) => tab.textContent)).toEqual(['部署与运行形态', '健康状态', '日志', '告警与通知', '事件投递', '调用链回放']);
  expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true'); expect(page.text()).not.toContain('查看此版本日志');
  await page.click('健康状态'); expect(page.search()).toEqual({ tab: 'health' }); expect(page.text()).toContain('查看此版本日志');
  page.unmount(); page = await renderApp(`/projects/${projectId}/operations?tab=status`);
  expect(page.search()).toEqual({ tab: 'topology' }); expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true');
});

test.each([
  // 2026-09-23 修订 RFC-020 D3：健康与形态重新分开，六个页签：部署与运行形态、健康状态、日志、告警与通知、事件投递、调用链回放。
  { from: 'logs', to: 'alerts', start: 2, end: 3, key: 'ArrowRight', before: 0, after: 98 },
  { from: 'topology', to: 'trace', start: 0, end: 5, key: 'ArrowLeft', before: 0, after: 300 },
  { from: 'trace', to: 'topology', start: 5, end: 0, key: 'Home', before: 300, after: 0 },
  { from: 'topology', to: 'trace', start: 0, end: 5, key: 'End', before: 0, after: 300 },
  { from: 'trace', to: 'topology', start: 5, end: 0, key: 'ArrowRight', before: 300, after: 0 },
])('窄屏键盘 $key / $from → $to 保留焦点滚动', async ({ from, to, start, end, key, before, after }) => {
  fixture(); page = await renderApp(`/projects/${projectId}/operations?tab=${from}`, undefined, undefined, { scrollRestoration: true });
  const list = document.querySelector<HTMLElement>('[role="tablist"][aria-label="运行与诊断"]')!;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const source = tabs[start]!, target = tabs[end]!;
  // 实机 320px 的标签条 [16, 304]；Happy DOM 没有布局，只注入这些量测值。
  const offsets = [0, 122, 216, 282, 390, 484], widths = [118, 90, 62, 104, 90, 104];
  Object.defineProperty(list, 'clientWidth', { value: 288 });
  list.getBoundingClientRect = () => new DOMRect(16, 0, 288, 42);
  tabs.forEach((tab, index) => { tab.getBoundingClientRect = () => new DOMRect(16 + offsets[index]! - list.scrollLeft, 0, widths[index]!, 34); });
  list.scrollLeft = before; list.dispatchEvent(new Event('scroll', { bubbles: true }));
  await act(async () => { source.focus(); source.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
  await page.settle();
  expect(page.search().tab).toBe(to); expect(document.activeElement).toBe(target);
  expect(target.getAttribute('aria-selected')).toBe('true');
  // 实机 320px 下，导航先记旧位置再 focus，内容切换后标签条回到 0，焦点标签被裁切。
  expect(list.scrollLeft).toBe(after);
  expect(target.getBoundingClientRect().left).toBeGreaterThanOrEqual(list.getBoundingClientRect().left);
  expect(target.getBoundingClientRect().right).toBeLessThanOrEqual(list.getBoundingClientRect().right);
});

test('缩窄后选中页签完整可见，不抢正文焦点，卸载停止观察', async () => {
  const originalObserver = globalThis.ResizeObserver, callbacks = new Map<Element, () => void>();
  globalThis.ResizeObserver = class implements ResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) { this.targets.add(target); callbacks.set(target, () => this.callback([], this)); }
    unobserve(target: Element) { this.targets.delete(target); callbacks.delete(target); }
    disconnect() { for (const target of this.targets) callbacks.delete(target); this.targets.clear(); }
  };
  try {
    fixture(); page = await renderApp(`/projects/${projectId}/operations?tab=trace`);
    const list = document.querySelector<HTMLElement>('[role="tablist"][aria-label="运行与诊断"]')!;
    const selected = list.querySelector<HTMLButtonElement>('[aria-selected="true"]')!;
    const field = document.querySelector<HTMLInputElement>('input')!;
    let width = 500;
    Object.defineProperty(list, 'clientWidth', { get: () => width });
    list.getBoundingClientRect = () => new DOMRect(16, 0, width, 42);
    selected.getBoundingClientRect = () => new DOMRect(378 - list.scrollLeft, 0, 104, 34);
    await act(async () => field.focus());
    width = 288; await act(async () => callbacks.get(list)?.());
    // 实机选中末尾页签后缩到 320px，原标签仍在 [378, 482]，整项藏在 [16, 304] 之外。
    expect(list.scrollLeft).toBe(178);
    expect(selected.getBoundingClientRect().right).toBeLessThanOrEqual(list.getBoundingClientRect().right);
    expect(document.activeElement).toBe(field); expect(page.search().tab).toBe('trace');
    page.unmount(); page = undefined; expect(callbacks.has(list)).toBe(false);
  } finally { globalThis.ResizeObserver = originalObserver; }
});

test('分类参数只接受有效且相关的值，未知对象不降级为另一个对象', () => {
  expect(parseSettingsSearch({ tab: 'bad', env: 'production', operation: 'foo' })).toEqual({ tab: 'config', env: 'production' });
  expect(parseSettingsSearch({ tab: 'config', env: 'bad', proxy: 'foo' })).toEqual({ tab: 'config', env: 'development' });
  expect(parseOperationsSearch({ tab: 'logs', source: 'build', taskId, releaseId, limit: 5000, since: 'bad' })).toEqual({ tab: 'logs', source: 'build', releaseId, since: undefined, limit: 200 });
  expect(parseOperationsSearch({ tab: 'trace', traceId: 'not-a-trace', releaseId })).toEqual({ tab: 'trace', traceId: undefined });
  expect([parseOperationsSearch({}), parseOperationsSearch({ tab: 'status' }), parseOperationsSearch({ tab: 'health', slot: 'preview' })]).toEqual([{ tab: 'topology' }, { tab: 'topology' }, { tab: 'health' }]);
  expect(parseSettingsSearch({ tab: 'resources', resource: 'api', operation: 'x'.repeat(2049), proxy: '\nfoo' })).toEqual({ tab: 'resources', resource: 'api', operation: undefined, proxy: undefined });
});
