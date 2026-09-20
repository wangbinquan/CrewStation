import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = `prj_${'a'.repeat(32)}`, serviceId = `svc_${'b'.repeat(32)}`;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(admin = false) {
  const writes: Array<{ url: string; body: unknown }> = [];
  const state = { failure: true, requested: false };
  globalThis.fetch = (async (raw, init) => {
    const url = String(raw); let status = 200, body: unknown = { items: [] };
    if (url.endsWith('/v1/me')) body = { id: 'user', name: '开发者', platformRole: (admin) ? 'admin' : 'developer', isAdmin: admin, memberships: [{ projectId, role: 'owner' }] };
    else if (url.endsWith(`/v1/projects/${projectId}`)) body = { id: projectId, serviceId, name: '知识助理', slug: 'knowledge', kind: 'DigitalWorker', state: 'active' };
    else if (url.includes('/catalog/operations')) body = { items: [{ key: 'billing:GET:/invoices', proxy: 'billing', method: 'GET', path: '/invoices', openPolicy: 'targeted', granted: false }] };
    else if (init?.method === 'POST') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      if (state.failure) { status = 503; body = { error: 'unavailable', message: '申请服务暂不可用' }; }
      else { state.requested = true; body = { id: 'request', serviceId, operationKey: 'billing:GET:/invoices', state: 'pending', reason: '查询账单', requestedBy: 'user', createdAt: '2026-09-13T01:00:00.000Z' }; }
    } else if (url.includes('/api-requests') && state.requested) body = { items: [{ id: 'request', serviceId, operationKey: 'billing:GET:/invoices', state: 'pending', reason: '查询账单', requestedBy: 'user', requestedByName: '开发者小李', createdAt: '2026-09-13T01:00:00.000Z' }] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { writes, state };
}

async function reason(value: string) {
  const node = document.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    node.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.settle();
}

test('申请失败保留打开的表单与理由，重试成功才收起并显示真实待审状态', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  await page.click('申请定向开放'); await reason('查询账单'); await page.click('提交申请');
  // 旧实现提交即卸载行内表单，服务失败后理由消失；这里只在成功后收起。
  expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('查询账单');
  expect(page.text()).toContain('申请服务暂不可用'); expect(f.writes).toHaveLength(1);
  f.state.failure = false; await page.click('提交申请');
  expect(f.writes).toHaveLength(2); expect(f.writes[1]!.body).toEqual({ operationKey: 'billing:GET:/invoices', reason: '查询账单' });
  expect(document.querySelector('textarea')).toBeNull(); expect(page.text()).toContain('待审批');
  // 申请人显示可辨识名字而不是原始用户 ID（ID 保留在 title 里）。
  expect(page.text()).toContain('开发者小李'); expect(page.html()).toContain('title="user"');
});

test('管理员在项目消费页也不出现平台写操作，只给保留项目上下文的管理入口', async () => {
  fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  expect(page.text()).not.toContain('改为默认开放'); expect(page.text()).not.toContain('撤销授权');
  expect(page.text()).toContain('管理接口开放策略');
});

test('当前用户缺少成员列表时 API 页面不崩溃，重新读取恢复后清除提示', async () => {
  const f = fixture(), fallback = globalThis.fetch; let incomplete = true;
  globalThis.fetch = (async (raw, init) => incomplete && String(raw).endsWith('/v1/me')
    ? Response.json({ id: 'user', name: '开发者', platformRole: 'developer', isAdmin: false }) : fallback(raw, init)) as typeof fetch;
  page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  expect(page.text()).toContain('当前用户资料不完整'); expect(page.text()).toContain('可调用的操作');
  expect(page.text()).not.toContain('Something went wrong'); expect(f.writes).toEqual([]);
  incomplete = false; await page.click('重新读取用户资料');
  expect(page.text()).not.toContain('当前用户资料不完整'); expect(f.writes).toEqual([]);
});

test('理由格式首屏提示，超过上限明确报错且不发送申请', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  await page.click('申请定向开放'); expect(page.text()).toContain('最多 500 字');
  await reason('字'.repeat(501)); await page.click('提交申请');
  expect(document.querySelector('textarea[aria-invalid="true"]')).not.toBeNull(); expect(f.writes).toHaveLength(0);
});
