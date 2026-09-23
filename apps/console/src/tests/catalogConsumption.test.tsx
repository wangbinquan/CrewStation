import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(admin = false) {
  const writes: Array<{ url: string; body: unknown }> = [];
  const state = { failure: true, requested: false };
  globalThis.fetch = (async (raw, init) => {
    const url = String(raw); let status = 200, body: unknown = { items: [] };
    if (url.endsWith('/v1/me')) body = { id: '01a0bf5d-8f4b-7fae-8c2f-e82b0fa04985', name: '开发者', platformRole: (admin) ? 'admin' : 'developer', isAdmin: admin, memberships: [{ projectId, role: 'owner' }] };
    else if (url.endsWith(`/v1/projects/${projectId}`)) body = { id: projectId, serviceId, name: '知识助理', slug: 'knowledge', kind: 'DigitalWorker', state: 'active' };
    // RFC-020 D2：接口目录住在开发页的参考面板里；没有开发会话时也能打开，所以这里明确“没有会话”。
    else if (url.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '没有开发会话' }; }
    else if (url.includes('/catalog/operations')) body = { items: [{ id: '01a0bf5d-8f4b-76a3-876b-499013b49883', proxyId: '01a0bf5d-8f4b-7274-8cd7-e347cbc132cf', proxy: 'billing', method: 'GET', path: '/invoices', openPolicy: 'targeted', granted: false }] };
    else if (init?.method === 'POST') {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      if (state.failure) { status = 503; body = { error: 'unavailable', message: '申请服务暂不可用' }; }
      else { state.requested = true; body = { id: '01a0bf5d-8f4b-74eb-82d5-2045557ce77e', serviceId, operationId: '01a0bf5d-8f4b-76a3-876b-499013b49883', state: 'pending', reason: '查询账单', requestedBy: '01a0bf5d-8f4b-7fae-8c2f-e82b0fa04985', createdAt: '2026-09-13T01:00:00.000Z' }; }
    } else if (url.includes('/api-requests') && state.requested) body = { items: [{ id: '01a0bf5d-8f4b-74eb-82d5-2045557ce77e', serviceId, operationId: '01a0bf5d-8f4b-76a3-876b-499013b49883', state: 'pending', reason: '查询账单', requestedBy: '01a0bf5d-8f4b-7fae-8c2f-e82b0fa04985', requestedByName: '开发者小李', createdAt: '2026-09-13T01:00:00.000Z' }] };
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

test('申请在弹窗里：失败保留弹窗与理由，重试成功才关窗并显示真实待审状态；关窗后理由留着', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  await page.click('申请');
  // RFC-020 §7：列表里的按钮选中该行（详情在旁）；2026-09-23 起申请表单在弹窗里，不再在详情栏展开。
  expect(document.querySelector('li[aria-current="true"]')?.textContent).toContain('/invoices');
  expect(document.querySelectorAll('aside[aria-label="操作详情"] textarea').length).toBe(0);
  const dialog = document.querySelector('dialog[open]')!; expect(dialog.textContent).toContain('申请定向开放'); expect(dialog.textContent).toContain('GET /invoices');
  await reason('查询账单'); await page.click('提交申请');
  // 旧实现提交即卸载行内表单，服务失败后理由消失；这里只在成功后关窗。
  expect(document.querySelector<HTMLTextAreaElement>('dialog[open] textarea')?.value).toBe('查询账单');
  expect(page.text()).toContain('申请服务暂不可用'); expect(f.writes).toHaveLength(1);
  // 取消只关窗，理由是这个操作的草稿；从详情栏再打开时还在。
  await page.click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.click('申请定向开放'); expect(document.querySelector<HTMLTextAreaElement>('dialog[open] textarea')?.value).toBe('查询账单');
  f.state.failure = false; await page.click('提交申请');
  expect(f.writes).toHaveLength(2); expect(f.writes[1]!.body).toEqual({ operationId: '01a0bf5d-8f4b-76a3-876b-499013b49883', reason: '查询账单' });
  expect(document.querySelectorAll('dialog').length).toBe(0); expect(page.text()).toContain('待审批');
  // 申请人显示可辨识名字而不是原始用户 ID（ID 保留在 title 里）。
  expect(page.text()).toContain('开发者小李'); expect(page.html()).toContain('title="01a0bf5d-8f4b-7fae-8c2f-e82b0fa04985"');
});

test('管理员在项目消费页也不出现平台写操作，只给保留项目上下文的管理入口', async () => {
  fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  expect(page.text()).not.toContain('改为默认开放'); expect(page.text()).not.toContain('撤销授权');
  expect(page.text()).toContain('管理接口开放策略');
});

test('当前用户缺少成员列表时 API 页面不崩溃，重新读取恢复后清除提示', async () => {
  const f = fixture(), fallback = globalThis.fetch; let incomplete = true;
  globalThis.fetch = (async (raw, init) => incomplete && String(raw).endsWith('/v1/me')
    ? Response.json({ id: '01a0bf5d-8f4b-7fae-8c2f-e82b0fa04985', name: '开发者', platformRole: 'developer', isAdmin: false }) : fallback(raw, init)) as typeof fetch;
  page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  expect(page.text()).toContain('当前用户资料不完整'); expect(page.text()).toContain('/invoices');
  expect(page.text()).not.toContain('Something went wrong'); expect(f.writes).toEqual([]);
  // 没有「重新读取用户资料」（2026-09-23 裁定）：资料不完整时每 15 秒自己再读；reread 模拟一次。
  incomplete = false; await page.reread();
  expect(page.text()).not.toContain('当前用户资料不完整'); expect(f.writes).toEqual([]);
});

test('理由格式首屏提示，超过上限明确报错且不发送申请', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=resources&resource=api`);
  await page.click('申请'); expect(page.text()).toContain('最多 500 字');
  await reason('字'.repeat(501)); await page.click('提交申请');
  expect(document.querySelector('textarea[aria-invalid="true"]')).not.toBeNull(); expect(f.writes).toHaveLength(0);
});
