import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

test('legacy recovery keeps unconfirmed stop visible, targets immutable identity and requires explicit stop confirmation', async () => {
  const posts: unknown[] = [], ticket = '01a0e20b-3ef1-7000-a077-1e8e87148af8'; let gone = false;
  globalThis.fetch = (async (raw: string | URL | Request, init?: RequestInit) => {
    const url = String(raw); let body: unknown = { items: [] };
    if (url.endsWith('/v1/me')) body = { id: 'admin', name: '管理员', isAdmin: true, platformRole: 'admin', memberships: [] };
    if (url.includes('/legacy-recovery')) {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); }
      body = { recovered: gone ? 1 : 0, items: gone ? [] : [{ id: ticket, kind: 'runner:exec', state: 'unknown', taskId: 'task-one', createdAt: '2026-09-27T00:00:00Z', blockedBy: ['runtime_stop_unconfirmed'], canStopRuntime: true }] };
    }
    return Response.json(body);
  }) as typeof fetch;
  page = await renderApp('/admin/business-execution');
  const input = document.querySelector('input[placeholder="project/service"]') as HTMLInputElement;
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'demo/service'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await act(async () => { input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
  expect(page.text()).toContain('运行环境尚未确认停止'); expect(posts).toHaveLength(0);
  await page.click('停止关联环境'); expect(posts).toHaveLength(0);
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('所有命令和 Agent 都会停止');
  await page.click('确认停止'); expect(posts).toEqual([{ identity: 'demo/service', action: 'stop', ticketId: ticket }]);
  expect(page.text()).toContain('运行环境尚未确认停止');
  gone = true; await page.click('核对停止证据');
  expect(posts[1]).toEqual({ identity: 'demo/service', action: 'reconcile' });
  expect(page.text()).toContain('没有未确认的旧执行票据');
});
