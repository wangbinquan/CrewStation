import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { centerPath, centerProject, centerRequest, centerRoot, centerUser, resourceCenterFixture, resourceNodeFixture } from './resourceCenterFixture';

const originalFetch = globalThis.fetch; let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const dialog = () => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)!;
async function input(label: string, value: string) {
  await act(async () => { const node = [...dialog().querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')!; node.focus(); const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}
async function escape() { await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page!.settle(); }

test('管理员同页修改批准值，确认前没有写入；申请原值和版本分别保留', async () => {
  const f = resourceCenterFixture('admin'); f.state.snapshot.requests = [{ ...f.request(), state: 'pending', origin: 'owner-request' }];
  page = await renderApp(`/admin/projects/${centerProject}/resources?view=requests&request=${centerRequest}`);
  expect(dialog().textContent).toContain('原申请值'); await input('执行并发上限', '6'); await input('审批／调整意见', '按实际容量批准六个并发');
  await page.click('批准'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(f.writes).toHaveLength(0);
  await escape(); expect(dialog().querySelector('input')?.value).toBe('6'); await page.click('批准'); await page.click('确认提交');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]).toMatchObject({ path: `${centerRoot}/requests/${centerRequest}/decision`, body: { approve: true, values: { maxConcurrentTasks: 6 }, expectedVersion: 1, expectedRevision: 'revision-1' } });
  expect(f.state.snapshot.requests[0]!.requestedValues).toEqual({ maxConcurrentTasks: 8 }); expect(page!.path()).toContain('/resources');
});

for (const operation of ['reject', 'cancel', 'retry'] as const) test(`资源页在弹窗内完成 ${operation}，使用当前申请版本`, async () => {
  const f = resourceCenterFixture(operation === 'cancel' ? 'owner' : 'admin'); f.state.snapshot.requests = [{ ...f.request(), origin: 'owner-request', state: operation === 'retry' ? 'apply-failed' : 'pending' }];
  page = await renderApp(`${operation === 'cancel' ? centerPath : `/admin/projects/${centerProject}/resources`}?view=requests&request=${centerRequest}`);
  if (operation === 'reject') await input('审批／调整意见', '当前容量不足暂不批准');
  await page.click(operation === 'reject' ? '驳回' : operation === 'cancel' ? '撤回申请' : '重试同步'); expect(f.writes).toHaveLength(0); await page.click('确认提交');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]!.path).toEndWith(`/${operation === 'reject' ? 'decision' : operation}`); expect(f.writes[0]!.body['expectedVersion']).toBe(1);
  if (operation === 'reject') expect(f.writes[0]!.body['approve']).toBe(false);
});

test('已有生产授权在同页撤销；确认时重读期限，已过期时不写入，草稿保留后可以重新审核', async () => {
  const f = resourceCenterFixture('admin'), fallback = globalThis.fetch, bindingId = 'legacy-binding'; let expired = false;
  f.state.snapshot.nodes = [resourceNodeFixture('binding', { resourceId: bindingId, resourceType: 'data-binding', environment: 'production', state: 'active', name: '临时生产访问' })]; f.state.snapshot.edges = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path.endsWith('/data-bindings')) return Response.json({ items: [{ id: bindingId, taskId: centerProject, mode: 'diagnostic-readonly', state: 'active', requestedBy: centerUser, createdAt: '2026-09-30T00:00:00Z', expiresAt: expired ? '2020-01-01T00:00:00Z' : '2030-01-01T00:00:00Z' }] });
    if (path === `/v1/data-bindings/${bindingId}/revoke`) { f.writes.push({ path, body: JSON.parse(String(init?.body)) }); return Response.json({ state: 'revoked' }); }
    return fallback(raw, init);
  }) as typeof fetch;
  page = await renderApp(`/admin/projects/${centerProject}/resources?view=list`); await page.click('详情'); await page.click('撤销生产数据访问'); await input('申请／调整理由', '排查结束撤销临时访问'); await page.click('核对后提交'); expect(f.writes).toHaveLength(0);
  expired = true; await page.click('确认提交'); expect(dialog().textContent).toContain('资源暂不可管理'); expect(f.writes).toHaveLength(0);
  await escape(); await escape(); expired = false; await page.click('撤销生产数据访问'); expect(dialog().querySelector('textarea')?.value).toBe('排查结束撤销临时访问');
  await page.click('核对后提交'); await page.click('确认提交'); expect(f.writes).toEqual([{ path: `/v1/data-bindings/${bindingId}/revoke`, body: { decision: '排查结束撤销临时访问' } }]); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
});

for (const resourceType of ['api-operation', 'production-data'] as const) test(`旧 ${resourceType} 申请保持原审计 ID，在资源页完成审批`, async () => {
  const f = resourceCenterFixture('admin'), fallback = globalThis.fetch; f.state.snapshot.legacyRequests = [{ id: 'old-request', resourceType, targetResourceId: 'original-resource', name: '旧审批', state: 'requested', reason: '已有历史申请', requestedBy: centerUser as typeof f.state.snapshot.requests[number]['requestedBy'], requesterName: '项目负责人', createdAt: '2026-09-30T00:00:00Z', values: { ttlMinutes: 120 }, canDecide: true }];
  globalThis.fetch = (async (raw, init) => { const path = new URL(String(raw), 'http://localhost').pathname; if (init?.method === 'POST' && !path.includes('/resource-center')) { f.writes.push({ path, body: JSON.parse(String(init.body)) }); return Response.json({ state: 'approved' }); } return fallback(raw, init); }) as typeof fetch;
  page = await renderApp(`/admin/projects/${centerProject}/resources?view=requests`); await page.click('详情'); await input('审批／调整意见', '核对历史申请后批准'); await page.click('批准'); expect(f.writes).toHaveLength(0); await page.click('批准');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]!.path).toContain('old-request'); expect(f.writes[0]!.body).toEqual({ approve: true, decision: '核对历史申请后批准' }); expect(page.path()).toContain('/resources');
});

test('管理员同页开放申请目录；明确显示全平台影响，带当前政策版本保存', async () => {
  const f = resourceCenterFixture('admin'), fallback = globalThis.fetch, target = { resourceType: 'compute-profile' as const, resourceId: 'private-profile', action: 'grant' as const };
  const action = { id: 'catalog:private-profile', kind: 'catalog-policy' as const, target, label: '申请目录策略', current: { requestable: false }, fields: [{ key: 'requestable', label: '允许申请', type: 'boolean' as const, required: true }], impact: [], enabled: true };
  f.state.snapshot.nodes = [resourceNodeFixture('private-profile', { actions: [action] })]; f.state.snapshot.edges = [];
  globalThis.fetch = (async (raw, init) => { const path = new URL(String(raw), 'http://localhost').pathname;
    if (path.endsWith('/inspect')) return Response.json({ view: { target, name: '私有档位', revision: 'r1', current: {}, fields: [], impact: [], owned: false, available: true }, actions: [], policy: { resourceType: target.resourceType, resourceId: target.resourceId, revision: 3, requestable: false }, requestable: false });
    if (path.endsWith('/catalog-policy') && init?.method === 'PUT') { f.writes.push({ path, body: JSON.parse(String(init.body)) }); return Response.json({ revision: 4, requestable: true }); }
    return fallback(raw, init);
  }) as typeof fetch;
  page = await renderApp(`/admin/projects/${centerProject}/resources?view=list`); await page.click('详情'); await page.click('申请目录策略');
  expect(dialog().textContent).toContain('全平台项目是否可申请'); await act(async () => dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await page.settle(); await page.click('核对后提交'); expect(f.writes).toHaveLength(0); await page.click('确认提交');
  expect(f.writes).toEqual([{ path: `${centerRoot}/catalog-policy`, body: { target, policy: { expectedRevision: 3, requestable: true } } }]); expect(page.text()).toContain('申请目录策略已保存');
});
