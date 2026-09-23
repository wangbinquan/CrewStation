import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { parseCapabilitySearch, parseRequestSearch } from '../shared/admin/managementSearch';

const originalFetch = globalThis.fetch;
const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', integrationId = '01a0bf5d-8f4b-7fcb-815b-e99537cac400';
const project = { id: projectId, serviceId, name: '知识助理', slug: 'knowledge', kind: 'DigitalWorker', state: 'active', ownerUserId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0', namespace: 'cs-knowledge', createdAt: '2026-09-13T01:00:00.000Z' };
const integration = { id: integrationId, serviceId: '01a0bf5d-8f4b-7549-8049-52b214d44948', name: '账单接入', slug: 'billing', kind: 'APIProxy', state: 'active', ownerUserId: '01a0bf5d-8f4b-7f8b-8136-e631380738b0', namespace: 'cs-billing', createdAt: '2026-09-13T01:00:00.000Z' };
const key = '01a0bf5d-8f4b-76a3-876b-499013b49883', createdAt = '2026-09-13T01:00:00.000Z';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(options: { admin?: boolean; meFailure?: boolean; pendingMe?: boolean; producerSlug?: string } = {}) {
  const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
  const state = { projectsFailure: false, operationsFailure: false, apiFailure: false, decisionFailure: false, grant: true, policy: 'targeted', requestState: 'pending', decision: undefined as string | undefined };
  const request = () => ({ id: '01a0bf5d-8f4b-7835-8ec6-0f5b147720c4', serviceId, operationId: key, state: state.requestState, reason: '查询账单', requestedBy: project.ownerUserId, createdAt, decision: state.decision });
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    const data = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body: data }); let body: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') {
      if (options.pendingMe) return new Promise<Response>(() => {});
      if (options.meFailure) { status = 503; body = { error: 'unavailable', message: '身份读取失败' }; }
      else body = { id: '01a0bf5d-8f4b-7fae-8c2f-e82b0fa04985', name: '管理员', platformRole: (options.admin !== false) ? 'admin' : 'developer', isAdmin: options.admin !== false, memberships: [] };
    } else if (url.pathname === '/v1/projects/page') {
      if (state.projectsFailure) { status = 503; body = { error: 'unavailable', message: '项目目录失败' }; }
      else body = { items: [project, integration].filter((p) => url.searchParams.get('kind')?.split(',').includes(p.kind)).map((p) => ({ project: p, role: 'admin', ownerName: '管理员' })) };
    } else if (url.pathname === '/v1/projects') {
      if (state.projectsFailure) { status = 503; body = { error: 'unavailable', message: '项目目录失败' }; }
      else body = { items: url.searchParams.get('kind')?.includes('APIProxy') ? [integration] : [project, integration] };
    } else if (url.pathname === `/v1/projects/${projectId}`) {
      if (state.projectsFailure) { status = 503; body = { error: 'unavailable', message: '项目目录失败' }; }
      else body = project;
    }
    else if (url.pathname === `/v1/projects/${integrationId}`) body = integration;
    else if (/^\/v1\/projects\/[0-9a-f-]{36}$/.test(url.pathname)) { status = 404; body = { error: 'not_found', message: '未找到指定项目' }; }
    else if (url.pathname.endsWith('/openapi')) { status = 503; body = { error: 'unavailable', message: '文档暂不可用' }; }
    else if (url.pathname === '/v1/catalog/operations') {
      if (state.operationsFailure) { status = 503; body = { error: 'unavailable', message: '接口目录失败' }; }
      else body = { items: [{ id: key, proxyId: '01a0bf5d-8f4b-7274-8cd7-e347cbc132cf', proxy: 'billing', method: 'GET', path: '/invoices', openPolicy: state.policy, granted: url.searchParams.has('serviceId') ? state.grant : undefined }] };
    } else if (url.pathname.endsWith('/policy')) {
      state.policy = String(data!.openPolicy); body = { id: key, openPolicy: state.policy };
    } else if (method === 'DELETE') { state.grant = false; return new Response(null, { status: 204 }); }
    else if (url.pathname === '/v1/api-requests/page') {
      if (state.apiFailure) { status = 503; body = { error: 'unavailable', message: 'API 申请读取失败' }; }
      else body = { items: [request(), { ...request(), id: '01a0bf5d-8f4b-7bab-8ad6-bbcdfe38933e', operationId: '01a0bf5d-8f4b-7fa5-8125-ce76ae48be7c', state: 'approved' }]
        .filter((r) => url.searchParams.get('state') === 'all' || r.state === url.searchParams.get('state')).map((r) => ({ ...r, projectId, project })) };
    } else if (url.pathname === '/v1/api-requests') {
      if (state.apiFailure) { status = 503; body = { error: 'unavailable', message: 'API 申请读取失败' }; }
      else body = { items: [request(), { ...request(), id: '01a0bf5d-8f4b-7bab-8ad6-bbcdfe38933e', operationId: '01a0bf5d-8f4b-7fa5-8125-ce76ae48be7c', state: 'approved' }] };
    } else if (url.pathname === '/v1/api-requests/01a0bf5d-8f4b-7835-8ec6-0f5b147720c4/decision') {
      if (state.decisionFailure) { status = 503; body = { error: 'unavailable', message: '审批服务失败' }; }
      else { state.requestState = data!.approve ? 'approved' : 'rejected'; state.decision = data!.decision as string; body = request(); }
    // RFC-018：出站接口已删除，打到它就是 500，界面上任何残留调用都会立刻红。
    } else if (url.pathname.startsWith('/v1/egress') || url.pathname.includes('/egress/')) {
      status = 500; body = { error: 'unexpected', message: '出站接口已下线，不应被调用' };
    } else if (url.pathname === '/v1/catalog/event-types') body = { items: [{ eventType: 'billing.changed', producer: 'billing-events', producerProject: options.producerSlug ?? integrationId }] };
    else if (url.pathname.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, state, writes: () => calls.filter((call) => call.method !== 'GET') };
}

async function input(node: HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement, value: string) {
  await act(async () => {
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    node.focus(); Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}
const visible = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find((node) => !node.closest('[hidden]'))!;

describe('管理员能力与审批入口', () => {
  test('旧接入列表 replace 到能力分类，事件来源可打开管理项目；返回栈不绕旧地址', async () => {
    const f = fixture(); page = await renderApp('/admin/integrations', '/projects');
    expect(page.path()).toBe('/admin/capabilities'); expect(page.search().tab).toBe('integrations');
    expect(page.text()).toContain('账单接入'); expect(f.calls.some((call) => call.url.pathname === '/v1/catalog/operations')).toBe(false);
    await page.back(); expect(page.path()).toBe('/projects');
    await page.navigate('/admin/capabilities?tab=events'); await page.click(integrationId);
    expect(page.path()).toBe(`/admin/integrations/${integrationId}`);
  });

  test('旧 API 管理链接保留服务与操作上下文，平台策略必须明确确认后才提交', async () => {
    const f = fixture(); page = await renderApp(`/admin/api-catalog?projectId=${projectId}&proxy=01a0bf5d-8f4b-7274-8cd7-e347cbc132cf&operation=${encodeURIComponent(key)}`, '/projects');
    expect(page.path()).toBe('/admin/capabilities'); expect(page.search()).toMatchObject({ tab: 'api', projectId, proxy: '01a0bf5d-8f4b-7274-8cd7-e347cbc132cf', operation: key });
    expect(f.calls.find((call) => call.url.pathname === '/v1/catalog/operations')!.url.searchParams.get('serviceId')).toBe(serviceId);
    await page.click('改为默认开放'); expect(f.writes()).toHaveLength(0); expect(page.text()).toContain('此策略对所有服务生效');
    await page.click('确认'); expect(f.writes()).toHaveLength(1);
    expect(f.writes()[0]).toMatchObject({ method: 'PUT', body: { openPolicy: 'default' } });
    expect(decodeURIComponent(f.writes()[0]!.url.pathname)).toBe(`/v1/catalog/operations/${key}/policy`);
    expect(page.text()).toContain('已保存为默认开放'); await page.back(); expect(page.path()).toBe('/projects');
  });

  test('全局目录没有虚假的服务授权；选择调用方后撤销命令使用准确服务和操作', async () => {
    const f = fixture(); page = await renderApp('/admin/capabilities?tab=api');
    expect(page.text()).not.toContain('本服务'); expect(page.text()).not.toContain('撤销授权');
    await input(document.querySelector(`select option[value="${projectId}"]`)!.parentElement as HTMLSelectElement, projectId);
    await page.click('撤销授权'); expect(page.text()).toContain('知识助理'); expect(f.writes()).toHaveLength(0);
    await page.click('确认'); expect(f.writes()[0]?.method).toBe('DELETE');
    expect(decodeURIComponent(f.writes()[0]!.url.pathname)).toBe(`/v1/services/${serviceId}/grants/${key}`);
    expect(page.text()).toContain('定向授权已撤销'); expect(page.text()).toContain('未授权');
  });

  test('调用方未确认或未知时不退回全局操作，恢复目录后才查询该服务', async () => {
    const f = fixture(); f.state.projectsFailure = true; page = await renderApp(`/admin/capabilities?tab=api&projectId=${projectId}`);
    expect(page.text()).toContain('项目目录失败'); expect(page.text()).not.toContain('改为默认开放');
    expect(f.calls.some((call) => call.url.pathname === '/v1/catalog/operations')).toBe(false);
    f.state.projectsFailure = false; await page.reread(); expect(page.text()).toContain('改为默认开放');
    await page.navigate(`/admin/capabilities?tab=api&projectId=01a0bf5d-8f4b-7927-8d04-a341edee681a`);
    expect(page.text()).toContain('未找到指定项目'); expect(page.text()).not.toContain('改为默认开放');
  });

  test('审批草稿在筛选变化前受保护；API 失败保留理由，成功后展示决定并刷新项目结果', async () => {
    const f = fixture(); page = await renderApp(`/admin/requests?projectId=${projectId}`);
    expect(page.text()).not.toContain('01a0bf5d-8f4b-7fa5-8125-ce76ae48be7c'); await input(visible<HTMLTextAreaElement>('textarea'), '用途尚需补充');
    f.state.decisionFailure = true; await page.click('拒绝'); expect(page.text()).toContain('审批服务失败');
    expect(visible<HTMLTextAreaElement>('textarea').value).toBe('用途尚需补充');
    f.state.decisionFailure = false; await page.click('拒绝'); expect(f.writes().at(-1)!.body).toEqual({ approve: false, decision: '用途尚需补充' });
    // 裁定成功即清掉该申请的草稿，因此改筛选不再有未保存输入要确认。
    expect(page.text()).toContain('申请已拒绝'); await input(document.querySelector('select option[value="all"]')!.parentElement as HTMLSelectElement, 'all');
    expect(page.text()).toContain('01a0bf5d-8f4b-7fa5-8125-ce76ae48be7c'); expect(page.text()).toContain('用途尚需补充');
    expect(page.text()).not.toContain('审批意见有未保存的输入');
    await page.navigate(`/projects/${projectId}/settings?tab=resources&resource=api`);
    expect(page.text()).toContain('已拒绝'); expect([...document.querySelectorAll('button')].some((node) => node.textContent === '批准')).toBe(false);
  });

  test('RFC-018：审批页只剩一类，不再有出站页签、出站规则入口或出站读取', async () => {
    const f = fixture(); page = await renderApp('/admin/requests');
    expect(page.text()).toContain(key);
    for (const gone of ['出站申请', '查看出站放行规则', '处理出站申请', '刷新出站申请']) expect(page.text()).not.toContain(gone);
    expect(f.calls.some((c) => c.url.pathname.includes('egress'))).toBe(false);
    // 旧地址落到管理总览，不是 404。
    await page.navigate('/admin/egress'); expect(page.path()).toBe('/admin');
    expect(f.writes()).toHaveLength(0);
  });

  test('审批意见约束首屏可见，超限不发请求', async () => {
    const f = fixture(); page = await renderApp('/admin/requests'); expect(page.text()).toContain('最多 500 字');
    await input(visible<HTMLTextAreaElement>('textarea'), '字'.repeat(501)); await page.click('批准');
    expect(visible<HTMLTextAreaElement>('textarea').getAttribute('aria-invalid')).toBe('true'); expect(f.writes()).toHaveLength(0);
  });

  test('刷新失败保留意见草稿但不能按旧申请审批；恢复后可继续', async () => {
    const f = fixture(); page = await renderApp('/admin/requests');
    await input(visible<HTMLTextAreaElement>('textarea'), '保留 API 意见'); f.state.apiFailure = true;
    await page.reread(); expect(visible<HTMLTextAreaElement>('textarea').value).toBe('保留 API 意见');
    expect(page.text()).toContain('请刷新成功后再审批'); await page.click('批准'); expect(f.writes()).toHaveLength(0);
    f.state.apiFailure = false; await page.reread(); expect(visible<HTMLTextAreaElement>('textarea').disabled).toBe(false);
    expect(visible<HTMLTextAreaElement>('textarea').value).toBe('保留 API 意见'); expect(f.writes()).toHaveLength(0);
  });
});

test('从指定 API 文档进入管理再返回，恢复原分类与接口而不是成员页', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/catalog?proxy=01a0bf5d-8f4b-7274-8cd7-e347cbc132cf&operation=${encodeURIComponent(key)}`);
  await page.click('管理接口开放策略');
  expect(page.path()).toBe('/admin/capabilities');
  expect(page.search()).toMatchObject({ tab: 'api', projectId, proxy: '01a0bf5d-8f4b-7274-8cd7-e347cbc132cf', operation: key });
  await page.click('项目开发');
  // 实机只记 pathname，回程把 settings 的分类和操作丢掉，误落到默认成员页。
  expect(page.path()).toBe(`/projects/${projectId}/dev-session`);
  expect(page.search()).toEqual({ view: 'reference', panel: 'full', topic: 'api', proxy: '01a0bf5d-8f4b-7274-8cd7-e347cbc132cf', operation: key });
  expect(document.querySelector('[role="tablist"][aria-label="资源主题"] [aria-selected="true"]')?.textContent).toContain('调用接口');
  // 2026-09-23：定位到的操作是选中的那一行，界面上不再显示操作 ID。
  expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('/invoices'); expect(page.text()).not.toContain(`${key}`); expect(f.writes()).toHaveLength(0);
  await page.back(); expect(page.path()).toBe('/admin/capabilities');
  await page.back(); expect(page.search()).toMatchObject({ topic: 'api', operation: key });
});

test('旧接入列表保留搜索、类型、状态、负责人及翻页位置', async () => {
  const f = fixture(), ownerUserId = project.ownerUserId, cursor = 'next-page-cursor';
  page = await renderApp(`/admin/integrations?q=${encodeURIComponent('账单')}&kind=APIProxy&state=active&ownerUserId=${ownerUserId}&cursor=${cursor}`, '/projects');
  // 实机旧路由只传固定 tab，带筛选的书签被改成全部接入容器。
  expect(page.path()).toBe('/admin/capabilities');
  expect(page.search()).toEqual({ tab: 'integrations', q: '账单', kind: 'APIProxy', state: 'active', ownerUserId, cursor });
  const request = f.calls.find((call) => call.url.pathname === '/v1/projects/page')!;
  expect(Object.fromEntries(request.url.searchParams)).toMatchObject({ q: '账单', kind: 'APIProxy', state: 'active', ownerUserId, cursor });
  expect(visible<HTMLInputElement>('input').value).toBe('账单'); expect(f.writes()).toHaveLength(0);
  await page.back(); expect(page.path()).toBe('/projects');
});

test('管理新入口及兼容地址对非管理员保持拒绝，不读取平台目录和全部申请', async () => {
  for (const path of ['/admin/capabilities?tab=api', '/admin/requests', '/admin/api-catalog', '/admin/integrations', '/admin/projects']) {
    const f = fixture({ admin: false }); page = await renderApp(path);
    expect(page.text()).toContain('仅平台管理员可见');
    expect(f.calls.every((call) => call.url.pathname === '/v1/me')).toBe(true); page.unmount(); page = undefined;
  }
});

test('管理身份待定和错误时不提前读取供给或审批接口', async () => {
  for (const options of [{ pendingMe: true }, { meFailure: true }]) {
    const f = fixture(options); page = await renderApp('/admin/requests');
    expect(page.text()).not.toContain('API 定向开放申请'); expect(page.text()).not.toContain('仅平台管理员可见');
    expect(f.calls.every((call) => call.url.pathname === '/v1/me')).toBe(true); page.unmount(); page = undefined;
  }
});

test('管理分类只保留适用的有界参数', () => {
  expect(parseCapabilitySearch({ tab: 'events', projectId, operation: key })).toEqual({ tab: 'events' });
  expect(parseCapabilitySearch({ tab: 'api', projectId: 'bad', proxy: '\nfoo', operation: 'x'.repeat(2049) })).toEqual({ tab: 'api', projectId: undefined, proxy: undefined, operation: undefined });
  // RFC-018：申请页只剩一类，旧链接上的 tab 与 egressCursor 一并丢弃。
  expect(parseRequestSearch({ tab: 'egress', projectId, state: 'unknown', egressCursor: 'egress:20' })).toEqual({ projectId, state: 'pending' });
});


test('事件目录的生产项目是 slug 时跳到已筛选的接入目录，不发出无效的项目 ID 请求', async () => {
  const f = fixture({ producerSlug: 'billing' });
  page = await renderApp('/admin/capabilities?tab=events');
  await page.click('billing');
  expect(page.path()).toBe('/admin/capabilities');
  expect(page.search()).toMatchObject({ tab: 'integrations', q: 'billing' });
  expect(f.calls.some((call) => call.url.pathname === '/v1/projects/billing')).toBe(false);
  expect(page.text()).toContain('账单接入');
});
