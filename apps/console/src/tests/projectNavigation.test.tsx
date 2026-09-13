import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { parseOperationsSearch } from '../shared/project/operationsSearch';
import { parseSettingsSearch } from '../shared/project/settingsSearch';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = `prj_${'a'.repeat(32)}`, serviceId = `svc_${'b'.repeat(32)}`, taskId = `tsk_${'c'.repeat(32)}`, releaseId = `rel_${'d'.repeat(32)}`, traceId = 'e'.repeat(32);
const project = { id: projectId, serviceId, name: '团队知识助理', slug: 'team-knowledge', kind: 'DigitalWorker', state: 'active', namespace: 'cs-team-knowledge', createdAt: '2026-09-13T01:00:00.000Z' };
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const calls: Array<{ url: URL; method: string }> = [];
  let logFailure = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, 'http://localhost');
    calls.push({ url, method: init?.method ?? 'GET' });
    let status = 200, body: unknown = { items: [] };
    if (url.pathname === '/v1/me') body = { id: 'user', name: '小林', isAdmin: false, memberships: [{ projectId, role: 'owner' }] };
    else if (url.pathname === `/v1/projects/${projectId}`) body = project;
    else if (url.pathname === `/v1/projects/prj_${'f'.repeat(32)}`) body = { ...project, id: `prj_${'f'.repeat(32)}`, name: '另一个应用', slug: 'another-app' };
    else if (url.pathname === `/v1/services/${serviceId}`) body = { id: serviceId, projectId };
    else if (url.pathname.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    else if (url.pathname.endsWith('/health')) body = { items: [{ slot: 'prod', state: 'unknown', readyReplicas: 0, replicas: 1, restarts: 2, lastTransitionAt: '2026-09-13T01:00:00.000Z' }] };
    else if (url.pathname.endsWith('/logs') && logFailure) { status = 503; body = { error: 'unavailable', message: '读取 Pod 日志失败' }; }
    else if (url.pathname.endsWith('/logs')) body = { items: [{ ts: '2026-09-13T01:01:00.000Z', source: 'build', stream: 'stderr', message: 'build fixture line' }] };
    else if (url.pathname.includes('/openapi')) { status = 503; body = { error: 'unavailable', message: '文档暂不可用' }; }
    else if (url.pathname.endsWith('/operations')) body = { items: [
      { key: 'billing.getInvoice', proxy: 'billing', method: 'GET', path: '/invoices/{id}', openPolicy: 'default', granted: true },
      { key: 'docs.getArticle', proxy: 'docs', method: 'GET', path: '/articles/{id}', openPolicy: 'targeted', granted: false },
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

describe('五个项目入口与旧链接兼容', () => {
  test('项目名与 slug 取实际项目，五项导航；概览不再请求成员和仓库详情', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}`);
    const links = [...document.querySelectorAll('[aria-label="项目页面"] a')];
    expect(links.map((link) => link.textContent)).toEqual(['概览', '开发', '发布与上线', '运行与诊断', '项目设置']);
    expect(page.text()).toContain('团队知识助理'); expect(page.text()).toContain('team-knowledge');
    expect(document.querySelector('header.bar')?.textContent).not.toContain(projectId);
    expect(f.calls.some((call) => call.url.pathname.endsWith('/members') || call.url.pathname.endsWith('/repository'))).toBe(false);
    await page.click('项目设置'); expect(page.search().tab).toBe('members');
    expect(f.calls.some((call) => call.url.pathname.endsWith('/members'))).toBe(true);
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

  test('健康状态可定位对应槽日志，查询失败保留错误而不显示正常', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/operations`);
    f.failLogs(); await page.click('查看此版本日志');
    expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'prod' });
    expect(page.text()).toContain('读取 Pod 日志失败'); expect(page.text()).not.toContain('build fixture line');
  });

  test('旧接口链接保留代理与操作并实际定位，清除后恢复完整目录', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/catalog?proxy=billing&operation=billing.getInvoice`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); expect(page.search()).toMatchObject({ tab: 'resources', resource: 'api', proxy: 'billing', operation: 'billing.getInvoice' });
    expect(page.text()).toContain('billing.getInvoice'); expect(page.text()).not.toContain('docs.getArticle');
    expect(page.text()).not.toContain('管理员模式');
    await page.click('查看全部接口'); expect(page.search().operation).toBeUndefined(); expect(page.text()).toContain('docs.getArticle');
    expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('旧能力链接保留 API 操作，不存在的操作不偷偷展示其他操作', async () => {
    fixture(); page = await renderApp(`/projects/${projectId}/capabilities?operation=missing.operation`);
    expect(page.search()).toMatchObject({ tab: 'resources', resource: 'api', operation: 'missing.operation' });
    expect(page.text()).toContain('missing.operation'); expect(page.text()).not.toContain('billing.getInvoice');
  });

});

describe('诊断、订阅与配置的上下文', () => {
  test('同一设置路由切换项目会换上下文，上一项目草稿不进入新项目', async () => {
    fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
    await input(document.querySelector<HTMLInputElement>('input[placeholder="DATABASE_URL"]')!, 'OLD_PROJECT_DRAFT');
    await page.requestNavigate(`/projects/prj_${'f'.repeat(32)}/settings?tab=config`);
    expect(page.path()).toBe(`/projects/${projectId}/settings`); await page.click('放弃输入并离开');
    expect(page.text()).toContain('另一个应用'); expect(page.text()).not.toContain('团队知识助理');
    expect([...document.querySelectorAll<HTMLInputElement>('input')].some((node) => node.value === 'OLD_PROJECT_DRAFT')).toBe(false);
  });
  test('投递的订阅上下文可到开发资源定位；trace 点击使用项目作用域接口', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/events?subscription=sub-a`);
    expect(page.search()).toMatchObject({ tab: 'deliveries', subscription: 'sub-a' });
    expect(page.text()).toContain('最近 50 条'); expect(page.text()).toContain('git.push'); expect(page.text()).not.toContain('git.issue');
    await page.click('查看订阅'); expect(page.search()).toMatchObject({ tab: 'resources', resource: 'events', subscription: 'sub-a' });
    expect(document.querySelector('tr[aria-current="true"]')?.textContent).toContain('git.push');
    await page.back(); await page.click(traceId);
    expect(page.search()).toEqual({ tab: 'trace', traceId }); expect(page.text()).toContain('runner.connected');
    expect(f.calls.some((call) => call.url.pathname === `/v1/projects/${projectId}/traces/${traceId}`)).toBe(true);
    expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('配置默认开发组；切环境与返回保留两组各自草稿，不自动保存', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/config`);
    expect(page.search()).toMatchObject({ tab: 'config', env: 'development' });
    expect(document.querySelector('[aria-label="项目页面"] a[aria-current="page"]')?.textContent).toBe('项目设置');
    const nameInput = document.querySelector<HTMLInputElement>('input[placeholder="DATABASE_URL"]')!;
    await input(nameInput, 'DEV_DRAFT'); await page.click('生产取值组');
    expect(page.search().env).toBe('production'); expect(nameInput.closest('[hidden]')).not.toBeNull();
    const prodName = [...document.querySelectorAll<HTMLInputElement>('input[placeholder="DATABASE_URL"]')].find((node) => !node.closest('[hidden]'))!;
    await input(prodName, 'PROD_DRAFT'); await page.back();
    expect(page.search().env).toBe('development'); expect(nameInput.value).toBe('DEV_DRAFT'); expect(prodName.value).toBe('PROD_DRAFT');
    expect(f.calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  test('调用链格式约束首屏出现，错误输入不查询；用户确认有效 ID 才查', async () => {
    const f = fixture(); page = await renderApp(`/projects/${projectId}/operations?tab=trace&traceId=invalid`);
    expect(page.text()).toContain('32 位十六进制'); await page.click('查询调用链');
    expect(document.querySelector('input[aria-invalid="true"]')).not.toBeNull();
    expect(f.calls.some((call) => call.url.pathname.includes('/traces/'))).toBe(false);
    await input(document.querySelector<HTMLInputElement>('input[aria-invalid]')!, traceId); await page.click('查询调用链');
    expect(page.text()).toContain('runner.connected'); expect(page.search().traceId).toBe(traceId);
  });
});

test('分类参数只接受有效且相关的值，未知对象不降级为另一个对象', () => {
  expect(parseSettingsSearch({ tab: 'bad', env: 'production', operation: 'foo' })).toEqual({ tab: 'members' });
  expect(parseSettingsSearch({ tab: 'config', env: 'bad', proxy: 'foo' })).toEqual({ tab: 'config', env: 'development' });
  expect(parseOperationsSearch({ tab: 'logs', source: 'build', taskId, releaseId, limit: 5000, since: 'bad' })).toEqual({ tab: 'logs', source: 'build', releaseId, since: undefined, limit: 200 });
  expect(parseOperationsSearch({ tab: 'trace', traceId: 'not-a-trace', releaseId })).toEqual({ tab: 'trace', traceId: undefined });
  expect(parseSettingsSearch({ tab: 'resources', resource: 'api', operation: 'x'.repeat(2049), proxy: '\nfoo' })).toEqual({ tab: 'resources', resource: 'api', operation: undefined, proxy: undefined });
});
