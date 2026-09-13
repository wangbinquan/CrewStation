import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { parseCapabilitySearch, parseRequestSearch } from '../shared/admin/managementSearch';

const originalFetch = globalThis.fetch;
const projectId = `prj_${'a'.repeat(32)}`, serviceId = `svc_${'b'.repeat(32)}`, integrationId = `prj_${'c'.repeat(32)}`;
const project = { id: projectId, serviceId, name: '知识助理', slug: 'knowledge', kind: 'DigitalWorker', state: 'active' };
const integration = { id: integrationId, serviceId: `svc_${'d'.repeat(32)}`, name: '账单接入', slug: 'billing', kind: 'APIProxy', state: 'active' };
const key = 'billing:GET:/invoices', createdAt = '2026-09-13T01:00:00.000Z';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(options: { admin?: boolean; meFailure?: boolean; pendingMe?: boolean } = {}) {
  const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
  const state = { projectsFailure: false, operationsFailure: false, apiFailure: false, egressFailure: false, decisionFailure: false, grant: true, policy: 'targeted', requestState: 'pending', decision: undefined as string | undefined };
  const request = () => ({ id: 'api-1', serviceId, operationKey: key, state: state.requestState, reason: '查询账单', requestedBy: 'user', createdAt, decision: state.decision });
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    const data = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method, body: data }); let body: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') {
      if (options.pendingMe) return new Promise<Response>(() => {});
      if (options.meFailure) { status = 503; body = { error: 'unavailable', message: '身份读取失败' }; }
      else body = { id: 'user', name: '管理员', isAdmin: options.admin !== false, memberships: [] };
    } else if (url.pathname === '/v1/projects/page') {
      if (state.projectsFailure) { status = 503; body = { error: 'unavailable', message: '项目目录失败' }; }
      else body = { items: [integration].map((p) => ({ project: { ...p, namespace: `cs-${p.slug}`, ownerUserId: `usr_${'a'.repeat(32)}`, createdAt }, role: 'admin', ownerName: '管理员' })) };
    } else if (url.pathname === '/v1/projects') {
      if (state.projectsFailure) { status = 503; body = { error: 'unavailable', message: '项目目录失败' }; }
      else body = { items: url.searchParams.get('kind')?.includes('APIProxy') ? [integration] : [project, integration] };
    } else if (url.pathname === `/v1/projects/${projectId}`) body = project;
    else if (url.pathname === `/v1/projects/${integrationId}`) body = integration;
    else if (url.pathname === '/v1/catalog/operations') {
      if (state.operationsFailure) { status = 503; body = { error: 'unavailable', message: '接口目录失败' }; }
      else body = { items: [{ key, proxy: 'billing', method: 'GET', path: '/invoices', openPolicy: state.policy, granted: url.searchParams.has('serviceId') ? state.grant : undefined }] };
    } else if (url.pathname.endsWith('/policy')) {
      state.policy = String(data!.openPolicy); body = { key, openPolicy: state.policy };
    } else if (method === 'DELETE') { state.grant = false; return new Response(null, { status: 204 }); }
    else if (url.pathname === '/v1/api-requests') {
      if (state.apiFailure) { status = 503; body = { error: 'unavailable', message: 'API 申请读取失败' }; }
      else body = { items: [request(), { ...request(), id: 'api-2', operationKey: 'history-operation', state: 'approved' }] };
    } else if (url.pathname === '/v1/api-requests/api-1/decision') {
      if (state.decisionFailure) { status = 503; body = { error: 'unavailable', message: '审批服务失败' }; }
      else { state.requestState = data!.approve ? 'approved' : 'rejected'; state.decision = data!.decision as string; body = request(); }
    } else if (url.pathname === '/v1/egress/requests') {
      if (state.egressFailure) { status = 503; body = { error: 'unavailable', message: '出站申请读取失败' }; }
      else body = { items: [{ id: 'egress-1', projectId, fqdn: 'example.invalid', reason: '模型调用', state: 'pending', createdAt, requestedBy: 'user' }] };
    } else if (url.pathname === '/v1/catalog/event-types') body = { items: [{ eventType: 'billing.changed', producer: 'billing-events', producerProject: integrationId }] };
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
    await page.navigate('/admin/capabilities?tab=events'); await page.click('billing-events');
    expect(page.path()).toBe(`/admin/integrations/${integrationId}`);
  });

  test('旧 API 管理链接保留服务与操作上下文，平台策略必须明确确认后才提交', async () => {
    const f = fixture(); page = await renderApp(`/admin/api-catalog?projectId=${projectId}&proxy=billing&operation=${encodeURIComponent(key)}`, '/projects');
    expect(page.path()).toBe('/admin/capabilities'); expect(page.search()).toMatchObject({ tab: 'api', projectId, proxy: 'billing', operation: key });
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
    f.state.projectsFailure = false; await page.click('重新读取项目目录'); expect(page.text()).toContain('改为默认开放');
    await page.navigate(`/admin/capabilities?tab=api&projectId=prj_${'f'.repeat(32)}`);
    expect(page.text()).toContain('未找到指定项目'); expect(page.text()).not.toContain('改为默认开放');
  });

  test('两类审批页签保留各自草稿；API 失败保留理由，成功后展示决定并刷新项目结果', async () => {
    const f = fixture(); page = await renderApp(`/admin/requests?projectId=${projectId}`);
    expect(page.text()).not.toContain('history-operation'); await input(visible<HTMLTextAreaElement>('textarea'), '用途尚需补充');
    await page.click('出站申请'); await input(visible<HTMLInputElement>('input'), '允许模型出口');
    await page.click('API 申请'); expect(visible<HTMLTextAreaElement>('textarea').value).toBe('用途尚需补充');
    await page.click('出站申请'); expect(visible<HTMLInputElement>('input').value).toBe('允许模型出口'); await page.click('API 申请');
    f.state.decisionFailure = true; await page.click('拒绝'); expect(page.text()).toContain('审批服务失败');
    expect(visible<HTMLTextAreaElement>('textarea').value).toBe('用途尚需补充');
    f.state.decisionFailure = false; await page.click('拒绝'); expect(f.writes().at(-1)!.body).toEqual({ approve: false, decision: '用途尚需补充' });
    expect(page.text()).toContain('申请已拒绝'); await input(document.querySelector('select option[value="all"]')!.parentElement as HTMLSelectElement, 'all');
    expect(page.text()).toContain('history-operation'); expect(page.text()).toContain('用途尚需补充');
    await page.navigate(`/projects/${projectId}/settings?tab=resources&resource=api`);
    expect(page.text()).toContain('已拒绝'); expect([...document.querySelectorAll('button')].some((node) => node.textContent === '批准')).toBe(false);
  });

  test('申请的两种数据源各自失败和恢复，不把失败显示为空；出站规则入口仍可到审批', async () => {
    const f = fixture(); f.state.egressFailure = true; page = await renderApp('/admin/requests');
    expect(page.text()).toContain(key); await page.click('出站申请'); expect(page.text()).toContain('出站申请读取失败');
    f.state.egressFailure = false; await page.click('刷新出站申请'); expect(page.text()).toContain('example.invalid');
    await page.click('查看出站放行规则'); expect(page.path()).toBe('/admin/egress');
    await page.click('处理出站申请'); expect(page.search().tab).toBe('egress');
  });

  test('审批意见约束首屏可见，API 超限或出站留空都不发请求', async () => {
    const f = fixture(); page = await renderApp('/admin/requests'); expect(page.text()).toContain('最多 500 字');
    await input(visible<HTMLTextAreaElement>('textarea'), '字'.repeat(501)); await page.click('批准');
    expect(visible<HTMLTextAreaElement>('textarea').getAttribute('aria-invalid')).toBe('true'); expect(f.writes()).toHaveLength(0);
    await page.click('出站申请');
    const approve = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '批准' && !node.closest('[hidden]'))!;
    await act(async () => approve.click()); await page.settle();
    expect(visible<HTMLInputElement>('input').getAttribute('aria-invalid')).toBe('true'); expect(f.writes()).toHaveLength(0);
  });

  test('刷新失败保留意见草稿但不能按旧申请审批；恢复后可继续', async () => {
    const f = fixture(); page = await renderApp('/admin/requests');
    await input(visible<HTMLTextAreaElement>('textarea'), '保留 API 意见'); f.state.apiFailure = true;
    await page.click('刷新 API 申请'); expect(visible<HTMLTextAreaElement>('textarea').value).toBe('保留 API 意见');
    expect(page.text()).toContain('请刷新成功后再审批'); await page.click('批准'); expect(f.writes()).toHaveLength(0);
    f.state.apiFailure = false; await page.click('刷新 API 申请'); expect(visible<HTMLTextAreaElement>('textarea').disabled).toBe(false);
    await page.click('出站申请'); await input(visible<HTMLInputElement>('input'), '保留出站意见'); f.state.egressFailure = true;
    await page.click('刷新出站申请'); expect(visible<HTMLInputElement>('input').value).toBe('保留出站意见'); expect(visible<HTMLInputElement>('input').disabled).toBe(true);
    expect(f.writes()).toHaveLength(0); f.state.egressFailure = false; await page.click('刷新出站申请');
    expect(visible<HTMLInputElement>('input').value).toBe('保留出站意见'); expect(visible<HTMLInputElement>('input').disabled).toBe(false);
  });
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
  expect(parseRequestSearch({ tab: 'unknown', projectId, state: 'unknown' })).toEqual({ tab: 'api', projectId, state: 'pending' });
});
