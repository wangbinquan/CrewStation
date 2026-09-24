import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AppAccessRequestDto, AppAccessStatusDto, ProjectId, UserId } from '@crewstation/contracts';
import { act } from 'react';
import { renderApp } from './renderApp';
import { summaryFixture } from './projectSummaryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

const projectId = '01a0bf5d-8f4b-7aef-84b8-c458233bab22' as ProjectId, me = '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId;
const requester = '01a0bf5d-8f4b-7baf-8eed-680262285455' as UserId, other = '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb' as UserId;
const at = '2026-09-24T08:00:00.000Z';
const request = (id: number, overrides: Partial<AppAccessRequestDto> = {}): AppAccessRequestDto => ({
  id: `01a0bf5d-8f4b-7a09-8000-${id.toString(16).padStart(12, '0')}`, projectId, state: 'pending', requestedBy: requester,
  requestedByName: '小林', requestedByEmail: 'lin@test.invalid', reason: '要看周报', createdAt: at, ...overrides,
});

/** 申请页、应用展示页与管理空间共用的假后端：只替换 HTTP 边界。 */
function fixture(options: { readonly status?: AppAccessStatusDto; readonly requests?: AppAccessRequestDto[]; readonly role?: string; readonly admin?: boolean } = {}) {
  const state = { status: options.status, requests: options.requests ?? [], writes: [] as Array<{ path: string; body: Record<string, unknown> }> };
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    let result: unknown = { items: [] }, status = 200;
    if (method === 'POST') {
      state.writes.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/access-requests')) {
        const created = request(9, { requestedBy: me, requestedByName: '我', ...(body.reason ? { reason: String(body.reason) } : { reason: undefined }) });
        state.status = { ...state.status!, latest: created }; result = created; status = 201;
      } else {
        const target = state.requests.find((item) => url.pathname.includes(item.id))!;
        Object.assign(target, { state: body.approve ? 'approved' : 'rejected', decidedBy: me, decidedByName: '负责人', decidedAt: at, ...(body.decision ? { decision: body.decision } : {}) });
        result = { ...target }; state.requests = state.requests.filter((item) => item.id !== target.id);
      }
    } else if (url.pathname === '/v1/me') {
      result = { id: me, name: '当前用户', email: 'me@test.invalid', platformRole: options.admin ? 'admin' : 'developer', isAdmin: options.admin ?? false, memberships: options.role ? [{ projectId, role: options.role }] : [], authMethod: 'password' };
    } else if (url.pathname === `/v1/apps/${projectId}/access`) result = state.status;
    else if (url.pathname === '/v1/app-access-requests') result = { items: state.requests.filter((item) => url.searchParams.get('state') === 'all' || item.state === url.searchParams.get('state')) };
    else if (url.pathname === `/v1/projects/${projectId}`) result = { id: projectId, slug: 'weekly', name: '周报助手', kind: 'DigitalWorker', ownerUserId: me, state: 'active' };
    else if (url.pathname.endsWith('/app-visibility')) result = { mode: 'members', allowRequests: true, revision: 1, updatedAt: null, canConfigure: true };
    else if (url.pathname.endsWith('/app-presentation')) result = { description: '整理周报', icon: 'book', revision: 1, updatedAt: null };
    else if (url.pathname.endsWith('/dev-session')) { status = 404; result = { error: 'not_found', message: '无会话' }; }
    return Response.json(result, { status });
  }) as typeof fetch;
  return state;
}
const status = (overrides: Partial<AppAccessStatusDto> = {}): AppAccessStatusDto => ({ projectId, name: '周报助手', owner: { name: '王五' }, granted: false, allowRequests: true, appHost: 'weekly.cs.localhost', ...overrides });
async function type(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    node.focus(); const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.settle();
}
const cardTitles = () => [...document.querySelectorAll('main section > header > h2')].map((node) => node.textContent);

describe('申请访问权限页（2026-09-24 裁定）', () => {
  test('没有权限且允许申请：填可选理由提交，随后显示「已申请，等待负责人处理」，不再给表单', async () => {
    const f = fixture({ status: status() }); page = await renderApp(`/apps/${projectId}/access`);
    expect(page.text()).toContain('你没有应用「周报助手」的使用权限'); expect(page.text()).toContain('项目负责人：王五');
    await type(document.querySelector('textarea')!, '  要看周报  '); await page.click('提交申请');
    expect(f.writes).toEqual([{ path: `/v1/apps/${projectId}/access-requests`, body: { reason: '要看周报' } }]);
    expect(page.text()).toContain('已申请，等待负责人处理'); expect(document.querySelector('textarea')).toBeNull();
  });

  test('理由超过 500 字不提交；被拒后写明负责人的意见，按钮变成「重新申请」', async () => {
    const f = fixture({ status: status({ latest: request(1, { requestedBy: me, state: 'rejected', decision: '请走部门流程', decidedAt: at }) }) });
    page = await renderApp(`/apps/${projectId}/access`);
    expect(page.text()).toContain('负责人拒绝了申请'); expect(page.text()).toContain('负责人的意见：请走部门流程');
    await type(document.querySelector('textarea')!, '长'.repeat(501)); await page.click('重新申请');
    expect(page.text()).toContain('申请理由不能超过 500 字'); expect(f.writes).toHaveLength(0);
    await type(document.querySelector('textarea')!, ''); await page.click('重新申请');
    expect(f.writes).toEqual([{ path: `/v1/apps/${projectId}/access-requests`, body: {} }]);
  });

  test('负责人只能授权：写负责人名字，没有表单；已有权限：给「打开应用」', async () => {
    fixture({ status: status({ allowRequests: false }) }); page = await renderApp(`/apps/${projectId}/access`);
    expect(page.text()).toContain('负责人没有开放申请，请联系项目负责人：王五'); expect(document.querySelector('textarea')).toBeNull();
    page.unmount(); fixture({ status: status({ granted: true, latest: request(1, { requestedBy: me, state: 'approved', decidedAt: at }) }) });
    page = await renderApp(`/apps/${projectId}/access`);
    expect(page.text()).toContain('你已经可以使用这个应用'); expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector<HTMLAnchorElement>('a[href="http://weekly.cs.localhost"]')?.textContent).toBe('打开应用');
  });
});

describe('使用申请的审批', () => {
  test('应用展示页的「使用申请」：同意直接加为用户；拒绝在弹窗里写理由，取消关窗理由留着，提交带上理由', async () => {
    const f = fixture({ role: 'owner', requests: [request(1), request(2, { requestedBy: other, requestedByName: '小周', reason: undefined })] });
    page = await renderApp(`/projects/${projectId}/settings?tab=visibility`);
    expect(page.text()).toContain('使用申请'); expect(page.text()).toContain('理由：要看周报'); expect(page.text()).toContain('没有填写理由');
    await page.click('同意');
    expect(f.writes[0]).toEqual({ path: `/v1/app-access-requests/${request(1).id}/decision`, body: { approve: true } });
    expect(page.text()).toContain('已同意 小林 的申请，已加为「用户」。');
    await page.click('拒绝'); await type(document.querySelector('dialog[open] textarea')!, '请走部门流程');
    await page.click('取消'); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
    await page.click('拒绝'); expect(document.querySelector<HTMLTextAreaElement>('dialog[open] textarea')!.value).toBe('请走部门流程');
    await act(async () => { document.querySelector<HTMLFormElement>('dialog[open] form')!.requestSubmit(); }); await page.settle();
    expect(f.writes[1]).toEqual({ path: `/v1/app-access-requests/${request(2).id}/decision`, body: { approve: false, decision: '请走部门流程' } });
    expect(page.text()).toContain('当前没有待处理的使用申请');
  });

  test('开发者看不到「使用申请」卡；概览给负责人提醒待处理的条数，入口指向应用展示', async () => {
    fixture({ role: 'developer', requests: [request(1)] }); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`);
    expect(cardTitles()).toEqual(['应用展示资料', '可见范围']); page.unmount();
    const summary = summaryFixture(), served = globalThis.fetch, id = summary.item.project.id;
    globalThis.fetch = (async (raw, init) => new URL(String(raw), 'http://localhost').pathname === '/v1/app-access-requests'
      ? Response.json({ items: [request(1, { projectId: id }), request(2, { projectId: id })] }) : served(raw, init)) as typeof fetch;
    page = await renderApp(`/projects/${id}`);
    expect(page.text()).toContain('2 条使用申请待处理');
    expect(document.querySelector<HTMLAnchorElement>(`a[href="/projects/${id}/settings?tab=visibility"]`)?.textContent).toBe('去处理');
  });

  test('管理空间「申请审批」多一栏应用使用申请：带应用名链接，已处理的写明谁在何时处理', async () => {
    fixture({ admin: true, requests: [request(1, { project: { id: projectId, name: '周报助手', slug: 'weekly', kind: 'DigitalWorker' } }),
      request(2, { state: 'rejected', decidedByName: '管理员', decidedAt: at, decision: '重复申请' })] });
    page = await renderApp('/admin/requests?state=all');
    expect(page.text()).toContain('应用使用申请');
    expect(document.querySelector<HTMLAnchorElement>(`a[href="/projects/${projectId}/settings?tab=visibility"]`)?.textContent).toBe('周报助手');
    expect(page.text()).toContain('意见：重复申请'); expect(page.text()).toContain('已拒绝');
  });
});

describe('成员页的「用户」角色', () => {
  test('平台普通用户只能设为测试者或用户，开发者与负责人选项不可选', async () => {
    const f = fixture({ role: 'owner' }), served = globalThis.fetch;
    globalThis.fetch = (async (raw, init) => {
      const url = new URL(String(raw), 'http://localhost');
      if (url.pathname.endsWith('/member-candidates')) return Response.json({ items: [{ userId: requester, name: '小林', email: 'lin@test.invalid', platformRole: 'user' }] });
      if (url.pathname.endsWith('/members') && (init?.method ?? 'GET') === 'GET') return Response.json({ items: [{ userId: me, name: '当前用户', email: 'me@test.invalid', role: 'owner' }] });
      if (url.pathname.endsWith('/members')) { f.writes.push({ path: url.pathname, body: JSON.parse(String(init!.body)) }); return Response.json({ userId: requester, name: '小林', email: 'lin@test.invalid', role: 'user' }); }
      return served(raw, init);
    }) as typeof fetch;
    page = await renderApp(`/projects/${projectId}/settings?tab=members`); await page.click('添加成员');
    await type([...document.querySelectorAll('dialog[open] label')].find((label) => label.textContent?.startsWith('完整邮箱或用户 ID'))!.querySelector('input')!, 'lin@test.invalid');
    await page.click('查找账号'); await page.click('选择此成员');
    const role = document.querySelector<HTMLSelectElement>('select[aria-label="成员角色"]')!;
    expect([...role.options].map((option) => [option.value, option.disabled])).toEqual([['owner', true], ['developer', true], ['tester', false], ['user', false]]);
    await type(role, 'user');
    expect(page.text()).toContain('只能打开正式地址、在市场里看到这个应用');
    await page.click('添加成员');
    expect(f.writes.at(-1)).toEqual({ path: `/v1/projects/${projectId}/members`, body: { userId: requester, role: 'user' } });
  });
});
