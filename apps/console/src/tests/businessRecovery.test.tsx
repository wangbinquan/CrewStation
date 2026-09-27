import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const projectId = '01a0bf5d-8f4b-7148-804c-6bd655d243f6', serviceId = '01a0bf5d-8f4b-76be-8473-58312e41bdd7';
const ticketId = '01a0bf5d-8f4b-7111-8111-000000000001';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(options: { empty?: boolean; serviceError?: boolean; blocked?: boolean; queryError?: boolean; count?: number } = {}) {
  const requests: Array<{ method: string; identity: string | null; body?: Record<string, unknown> }> = [];
  const item = { id: ticketId, kind: 'command', state: 'unknown', taskId: '01a0bf5d-8f4b-7111-8111-000000000002', createdAt: '2026-09-27T00:00:00Z', blockedBy: ['runtime_stop_unconfirmed'], canStopRuntime: !options.blocked };
  globalThis.fetch = (async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url, 'http://console.test');
    let body: unknown = { items: [] }, status = 200;
    if (url.pathname === '/v1/me') body = { id: 'admin', name: '管理员', isAdmin: true, platformRole: 'admin', memberships: [] };
    if (url.pathname === '/v1/projects') body = { items: options.empty ? [] : [{ id: projectId, serviceId, name: '财务助手', slug: 'finance', state: 'active', kind: 'DigitalWorker' }] };
    if (url.pathname === `/v1/services/${serviceId}`) {
      body = options.serviceError ? { error: 'forbidden', message: '服务信息不可读取' } : { id: serviceId, projectId, name: 'invoice-worker', identity: 'finance/canonical-service' };
      if (options.serviceError) status = 403;
    }
    if (url.pathname.endsWith('/business-execution/tasks')) body = { items: options.empty ? [] : Array.from({ length: options.count ?? 1 }, (_, i) => ({ id: i === 0 ? item.taskId : `01a0bf5d-8f4b-7111-8111-${String(i + 10).padStart(12, '0')}`, projectId, serviceId, callerIdentity: 'finance/canonical-service', protocol: 'legacy', state: 'failed', attention: 'failed', failedSubtasks: 1, unknownSubtasks: 0, labels: { name: i === 0 ? '生成月度报告' : `报告任务 ${i + 1}` }, message: '工具执行失败', createdAt: item.createdAt, updatedAt: item.createdAt })) };
    if (url.pathname.endsWith('/legacy-recovery')) {
      const data = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method: init?.method ?? 'GET', identity: url.searchParams.get('identity'), ...(data ? { body: data } : {}) });
      body = options.queryError ? { error: 'forbidden', message: '恢复信息不可读取' } : { recovered: init?.method === 'POST' ? 1 : 0, items: [item] };
      if (options.queryError) status = 403;
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests };
}

async function chooseProject() {
  const select = document.querySelector<HTMLSelectElement>('main select');
  expect(select !== null).toBe(true);
  await act(async () => { select!.value = projectId; select!.dispatchEvent(new Event('change', { bubbles: true })); });
  await page!.settle();
}

test('打开即显示真实任务列表，按项目筛选并选择任务，不要求猜内部身份', async () => {
  const f = fixture(); page = await renderApp('/admin/business-execution');
  // 作者反馈：原页面只有 project/service 文本框，使用者无法知道该填什么。
  expect(document.querySelector('main input[placeholder="project/service"]') === null).toBe(true);
  expect(document.querySelector('main select')?.textContent).toContain('财务助手');
  expect(f.requests).toHaveLength(0);
  expect(page.text()).toContain('生成月度报告'); expect(page.text()).toContain('工具执行失败');
  await chooseProject(); await page.click('查看任务');
  // Task details must open at the viewport, never after a potentially long task table.
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open][role="dialog"]');
  expect(dialog !== null).toBe(true);
  expect(dialog?.textContent).toContain('财务助手 · 生成月度报告');
  expect(dialog?.textContent).toContain('运行环境尚未确认停止');
  expect(f.requests[0]).toMatchObject({ method: 'GET', identity: 'finance/canonical-service' });
  expect(page.text()).toContain('运行环境尚未确认停止');
});

test('长列表末行详情也在弹窗中，Escape 关闭后保留筛选、列表和原按钮焦点', async () => {
  fixture({ count: 30 }); page = await renderApp('/admin/business-execution'); await chooseProject();
  const filter = document.querySelector<HTMLSelectElement>('main select')!, table = document.querySelector('main table');
  const opener = [...document.querySelectorAll<HTMLButtonElement>('main button')].filter((button) => button.textContent === '查看任务').at(-1)!;
  await act(async () => { opener.focus(); opener.click(); }); await page.settle();
  const detail = document.querySelector<HTMLDialogElement>('dialog[open][role="dialog"]')!;
  expect(detail?.textContent).toContain('报告任务 30'); expect(document.activeElement === detail).toBe(true);
  expect(detail?.textContent).toContain('任务技术信息');
  await act(async () => { detail.dispatchEvent(new Event('cancel', { cancelable: true })); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  expect(document.activeElement === opener).toBe(true); expect(filter.value).toBe(projectId);
  expect(document.querySelector('main table') === table).toBe(true); expect(document.querySelectorAll('main tbody tr')).toHaveLength(30);
});

test('legacy recovery keeps unconfirmed stop visible, targets immutable identity and requires explicit stop confirmation', async () => {
  const posts: unknown[] = [], ticket = '01a0e20b-3ef1-7000-a077-1e8e87148af8'; let gone = false;
  globalThis.fetch = (async (raw: string | URL | Request, init?: RequestInit) => {
    const url = String(raw); let body: unknown = { items: [] };
    if (url.endsWith('/v1/me')) body = { id: 'admin', name: '管理员', isAdmin: true, platformRole: 'admin', memberships: [] };
    if (url.includes('/business-execution/tasks')) body = { items: [{ id: 'task-one', projectId, serviceId, callerIdentity: 'demo/service', protocol: 'legacy', state: 'unknown', attention: 'unknown', failedSubtasks: 0, unknownSubtasks: 1, labels: { name: '待确认任务' }, createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' }] };
    if (url.includes('/legacy-recovery')) {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); }
      body = { recovered: gone ? 1 : 0, items: gone ? [] : [{ id: ticket, kind: 'runner:exec', state: 'unknown', taskId: 'task-one', createdAt: '2026-09-27T00:00:00Z', blockedBy: ['runtime_stop_unconfirmed'], canStopRuntime: true }] };
    }
    return Response.json(body);
  }) as typeof fetch;
  page = await renderApp('/admin/business-execution');
  await page.click('查看任务');
  expect(page.text()).toContain('运行环境尚未确认停止'); expect(posts).toHaveLength(0);
  await page.click('停止关联环境'); expect(posts).toHaveLength(0);
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('所有命令和 Agent 都会停止');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await act(async () => { document.querySelector('[role="alertdialog"]')!.dispatchEvent(new Event('cancel', { cancelable: true })); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(posts).toHaveLength(0);
  await page.click('停止关联环境');
  await page.click('确认停止'); expect(posts).toEqual([{ identity: 'demo/service', action: 'stop', ticketId: ticket }]);
  expect(page.text()).toContain('运行环境尚未确认停止');
  gone = true; await page.click('核对停止证据');
  expect(posts[1]).toEqual({ identity: 'demo/service', action: 'reconcile' });
  expect(page.text()).toContain('没有未确认的旧执行票据');
});


test('空任务列表不显示身份输入；非管理员不读取任务', async () => {
  fixture({ empty: true }); page = await renderApp('/admin/business-execution');
  expect(page.text()).toContain('没有符合条件的业务任务'); expect(document.querySelector('main input') === null).toBe(true);
  page.unmount(); let reads = 0;
  globalThis.fetch = (async (raw) => { const path = String(raw); if (path.includes('/business-execution/tasks')) reads++; return Response.json(path.endsWith('/me') ? { id: 'viewer', isAdmin: false, memberships: [] } : { items: [] }); }) as typeof fetch;
  page = await renderApp('/admin/business-execution'); expect(reads).toBe(0);
});
