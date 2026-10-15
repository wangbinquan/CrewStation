import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { DeveloperAccessPageSchema, DeveloperAccessRequestDtoSchema, RequestDeveloperAccessSchema, ReviewDeveloperAccessSchema } from '@crewstation/contracts';
import { renderDeliveryHarness } from './renderDeliveryHarness';
import { projectCreationFixture, creationUserId } from './projectCreationFixture';

const fetchBefore = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderDeliveryHarness>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = fetchBefore; });
const request = (n = 1) => DeveloperAccessRequestDtoSchema.parse({ id: `01a0bf5d-8f4b-7a01-8000-${n.toString(16).padStart(12, '0')}`, userId: creationUserId, userName: `申请人 ${n}`, userEmail: `applicant${n}@test.invalid`, reason: `制作应用 ${n}`, state: 'pending', revision: 1, createdAt: new Date().toISOString(), reviewedAt: null, reviewerId: null, note: null });
async function text(value: string) { const node = document.querySelector('dialog textarea')! as HTMLTextAreaElement; await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle(); }

test('普通用户申请后显示持久待审批状态，关闭和重新打开不会重复提交', async () => {
  projectCreationFixture('user'); const base = globalThis.fetch, writes: unknown[] = []; let current: ReturnType<typeof request> | null = null;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://test').pathname;
    if (path !== '/v1/me/developer-access') return base(raw, init);
    if ((init?.method ?? 'GET') === 'GET') return Response.json({ request: current });
    const input = RequestDeveloperAccessSchema.parse(JSON.parse(String(init?.body))); writes.push(input); current = { ...request(), reason: input.reason }; return Response.json(current, { status: 201 });
  }) as typeof fetch;
  page = await renderDeliveryHarness('/projects'); await page.click('申请开发者权限'); await text('创建团队周报应用'); await page.click('提交申请');
  expect(writes).toEqual([{ reason: '创建团队周报应用' }]); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(page.text()).toContain('等待管理员审批');
  page.unmount(); page = await renderDeliveryHarness('/projects'); await page.click('申请开发者权限');
  expect(document.querySelector<HTMLButtonElement>('dialog button[type="submit"]')?.disabled).toBe(true); expect(writes).toHaveLength(1);
});

test('审批长列表末行打开统一弹窗，取消保持列表与焦点，提交携带原修订', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => request(i + 1)), writes: unknown[] = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://test').pathname;
    if (path === '/v1/admin/developer-access' && (init?.method ?? 'GET') === 'GET') return Response.json(DeveloperAccessPageSchema.parse({ items: rows.filter(row => row.state === 'pending') }));
    if (path === `/v1/admin/developer-access/${rows[19]!.id}/review` && init?.method === 'POST') {
      const input = ReviewDeveloperAccessSchema.parse(JSON.parse(String(init.body))); writes.push(input); rows[19] = { ...rows[19]!, state: input.decision, revision: 2, note: input.note }; return Response.json(rows[19]);
    }
    throw new Error(`Unexpected endpoint ${init?.method ?? 'GET'} ${path}`);
  }) as typeof fetch;
  page = await renderDeliveryHarness('/admin/requests'); const last = [...document.querySelectorAll<HTMLButtonElement>('tbody button')].at(-1)!;
  last.focus(); await act(async () => last.click()); await page.settle();
  expect(document.querySelector('dialog[open][data-cs-dialog]')?.textContent).toContain('申请人 20'); expect(document.querySelector('table dialog')).toBeNull();
  await text('允许创建项目');
  await page.click('取消'); expect(document.querySelectorAll('tbody tr')).toHaveLength(20); expect(document.activeElement === last).toBe(true);
  await act(async () => last.click()); await page.settle(); expect(document.querySelector<HTMLTextAreaElement>('dialog textarea')?.value).toBe('允许创建项目'); await page.click('确认审批结果');
  expect(writes).toEqual([{ decision: 'approved', expectedRevision: 1, note: '允许创建项目' }]); expect(document.querySelectorAll('tbody tr')).toHaveLength(19);
});

test('审批冲突保留意见并显示错误，不重复提交或假装成功', async () => {
  const row = request(); let writes = 0;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://test').pathname;
    if (path === '/v1/admin/developer-access' && (init?.method ?? 'GET') === 'GET') return Response.json({ items: [row] });
    if (path === `/v1/admin/developer-access/${row.id}/review` && init?.method === 'POST') { writes++; return Response.json({ error: 'conflict', message: '申请已由其他管理员处理' }, { status: 409 }); }
    throw new Error(`Unexpected endpoint ${path}`);
  }) as typeof fetch;
  page = await renderDeliveryHarness('/admin/requests'); await page.click('详情'); await text('同意申请'); await page.click('确认审批结果');
  expect(document.querySelector('dialog')?.textContent).toContain('申请已由其他管理员处理'); expect(document.querySelector<HTMLTextAreaElement>('dialog textarea')?.value).toBe('同意申请');
  await page.reread(); expect(writes).toBe(1);
});
