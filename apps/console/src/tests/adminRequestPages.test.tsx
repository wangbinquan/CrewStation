import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { adminRequestPagesFixture } from './adminRequestPagesFixture';
import { browserHistoryFixture } from './browserHistoryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const visible = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].filter((n) => !n.closest('[hidden]'));
async function click(label: string) {
  const target = visible<HTMLButtonElement>('button').find((b) => b.textContent === label)!;
  expect(Boolean(target)).toBe(true); await act(async () => target.click()); await page!.settle();
}
async function type(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => { node.focus(); const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value); node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}

test('审批只读取 20 项分页，游标随翻页进 URL，历史返回保留范围', async () => {
  const f = adminRequestPagesFixture(); page = await renderApp('/admin/requests');
  const apiCalls = () => f.calls.filter((c) => c.url.pathname === '/v1/api-requests/page');
  expect(apiCalls()).toHaveLength(1); expect(apiCalls()[0]!.url.searchParams.get('limit')).toBe('20');
  expect(f.calls.some((c) => ['/v1/projects', '/v1/api-requests'].includes(c.url.pathname))).toBe(false);
  expect(page.text()).toContain('申请项目 0'); expect(page.text()).toContain('tenant-0'); expect(page.text()).toContain('本页 20 项');
  await click('下一页'); expect(page.search().apiCursor).toBe('api:20'); expect(page.text()).toContain(f.apiRequests[20]!.operationId); expect(page.text()).not.toContain('账单申请 0');
  await page.back(); expect(page.search().apiCursor).toBeUndefined(); expect(f.writes()).toHaveLength(0);
});

test('RFC-018：页面不再读出站接口，旧的 tab／egressCursor 参数被忽略而不是空页', async () => {
  const f = adminRequestPagesFixture(); page = await renderApp('/admin/requests?tab=egress&egressCursor=egress%3A20');
  // 旧链接照常落到申请列表的第一页，不是空页也不是错误页；URL 上残留的参数不驱动任何读取。
  expect(page.text()).toContain('本页 20 项'); expect(page.text()).toContain(f.apiRequests[0]!.operationId);
  expect(f.calls.filter((c) => c.url.pathname === '/v1/api-requests/page').every((c) => !c.url.searchParams.has('cursor'))).toBe(true);
  expect(f.calls.some((c) => c.url.pathname.includes('egress'))).toBe(false);
  // 出站页签与它的入口都不该还在。
  expect(page.text()).not.toContain('出站申请'); expect(page.text()).not.toContain('查看出站放行规则');
  expect(f.writes()).toHaveLength(0);
});

test('/admin/egress 旧地址重定向到管理总览', async () => {
  adminRequestPagesFixture(); page = await renderApp('/admin/egress');
  expect(page.path()).toBe('/admin');
});

test('改变筛选先确认，取消保留输入，确认后按新范围读取', async () => {
  const f = adminRequestPagesFixture(); page = await renderApp('/admin/requests');
  await type(visible<HTMLTextAreaElement>('textarea')[0]!, 'API 草稿');
  await click('下一页'); expect(page.search().apiCursor).toBeUndefined(); expect(page.text()).toContain('审批意见有未保存的输入');
  await page.click('继续编辑'); expect(visible<HTMLTextAreaElement>('textarea')[0]!.value).toBe('API 草稿');
  await type(visible<HTMLSelectElement>('select[aria-label="申请状态"]')[0]!, 'approved'); expect(page.search().state ?? 'pending').toBe('pending');
  await page.click('放弃输入并离开'); expect(page.search().state).toBe('approved'); expect(page.search().apiCursor).toBeUndefined();
  expect(f.calls.at(-1)!.url.searchParams.get('state')).toBe('approved'); expect(f.writes()).toHaveLength(0);
});

// 2026-09-23 裁定：申请每 30 秒自动重读，没有「刷新 API 申请」按钮；reread 模拟一次自动重读。
test('自动重读移走申请时保留具名意见供核对；失败保留原草稿并暂停提交，恢复后可精确裁定', async () => {
  const f = adminRequestPagesFixture(), first = f.apiRequests[0]!; page = await renderApp('/admin/requests');
  expect(visible<HTMLButtonElement>('button').map((b) => b.textContent)).not.toContain('刷新 API 申请');
  await type(visible<HTMLTextAreaElement>('textarea')[0]!, '保留的核对意见'); f.state.apiError = 503;
  await page.reread(); expect(page.text()).toContain('本页数量未确认'); expect(visible<HTMLTextAreaElement>('textarea')[0]!.value).toBe('保留的核对意见');
  await click('批准'); expect(f.writes()).toHaveLength(0);
  first.state = 'approved'; f.state.apiError = 0; await page.reread();
  expect(page.text()).toContain('保留的意见'); expect(page.text()).toContain(first.operationId);
  const orphan = visible<HTMLTextAreaElement>('textarea[readonly]')[0]!; expect(orphan.value).toBe('保留的核对意见');
  await page.requestNavigate('/admin'); expect(page.text()).toContain('审批意见有未保存的输入'); await page.click('继续编辑');
  await click('清除这条意见'); await type(visible<HTMLTextAreaElement>('textarea')[0]!, '允许账单使用');
  await click('批准'); expect(f.writes()).toHaveLength(1); expect(f.writes()[0]!.url.pathname).toBe(`/v1/api-requests/${f.apiRequests[1]!.id}/decision`);
  expect(page.text()).toContain('申请已批准'); await page.navigate('/admin'); expect(page.path()).toBe('/admin');
});

test('裁定失败保留输入，同轮重复点击只提交一次，成功只清掉目标申请的意见', async () => {
  const f = adminRequestPagesFixture(); page = await renderApp('/admin/requests');
  await type(visible<HTMLTextAreaElement>('textarea')[0]!, '  允许账单查询  '); await type(visible<HTMLTextAreaElement>('textarea')[1]!, '另一条待核对');
  f.state.decisionError = true; await click('批准'); expect(page.text()).toContain('裁定提交失败'); expect(visible<HTMLTextAreaElement>('textarea')[0]!.value).toBe('  允许账单查询  ');
  f.state.decisionError = false; let finish!: () => void; f.state.holdDecision = new Promise<void>((resolve) => { finish = resolve; });
  const approve = visible<HTMLButtonElement>('button').find((b) => b.textContent === '批准')!;
  await act(async () => { approve.click(); approve.click(); }); await page.settle(); expect(f.writes()).toHaveLength(2);
  expect(f.writes()[1]!.url.pathname).toBe(`/v1/api-requests/${f.apiRequests[0]!.id}/decision`);
  expect(f.writes()[1]!.body).toEqual({ approve: true, decision: '  允许账单查询  ' });
  await act(async () => finish()); await page.settle(); expect(page.text()).toContain('申请已批准');
  expect(visible<HTMLTextAreaElement>('textarea')[0]!.value).toBe('另一条待核对');
});

test('空 API 意见在途也保护离开；确认离开后的迟到裁定不会拉回旧页或再次提交', async () => {
  const f = adminRequestPagesFixture(); let finish!: () => void; f.state.holdDecision = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderApp('/admin/requests');
  const approve = visible<HTMLButtonElement>('button').find((b) => b.textContent === '批准')!;
  await act(async () => { approve.click(); approve.click(); }); await page.settle(); expect(f.writes()).toHaveLength(1);
  expect(f.writes()[0]!.body).toEqual({ approve: true });
  await page.requestNavigate('/admin/users'); expect(page.text()).toContain('审批意见有未保存的输入');
  await page.click('继续编辑'); expect(page.path()).toBe('/admin/requests');
  await page.requestNavigate('/admin/users'); await page.click('放弃输入并离开'); expect(page.path()).toBe('/admin/users');
  await act(async () => finish()); await page.settle(); expect(page.path()).toBe('/admin/users'); expect(f.writes()).toHaveLength(1);
  expect(page.text()).not.toContain('申请已批准');
});

test('错误游标可回第一页；重复或错项目资料不当成空页，项目名称缺失时保留真实 ID', async () => {
  const f = adminRequestPagesFixture(); page = await renderApp('/admin/requests?apiCursor=bad%3A20');
  expect(page.text()).toContain('申请游标不匹配'); expect(page.text()).toContain('本页数量未确认');
  await click('回到第一页'); expect(page.search().apiCursor).toBeUndefined(); expect(page.text()).toContain('本页 20 项');
  f.state.invalidApi = true; await page.reread(); expect(page.text()).toContain('申请分页返回无效');
  expect(page.text()).toContain('本页数量未确认'); await click('批准'); expect(f.writes()).toHaveLength(0);
  f.state.invalidApi = false; const first = f.apiRequests[0]!; first.project = f.apiRequests[1]!.project;
  await page.reread(); expect(page.text()).toContain('申请分页返回无效');
  delete first.project; await page.reread(); expect(page.text()).not.toContain('申请分页返回无效');
  expect(visible<HTMLAnchorElement>('a').some((a) => a.textContent === first.projectId)).toBe(true);
  expect(f.calls.some((c) => c.url.pathname === '/v1/projects')).toBe(false); expect(f.writes()).toHaveLength(0);
});

test('返回错误申请的裁定不显示成功，不清除意见或自动重试；自动重读后仍可核对输入副本', async () => {
  const f = adminRequestPagesFixture(); f.state.wrongDecision = true; page = await renderApp('/admin/requests');
  await type(visible<HTMLTextAreaElement>('textarea')[0]!, '待核对裁定'); await click('批准');
  expect(page.text()).toContain('审批结果无法核对'); expect(page.text()).toContain('请求可能已经执行'); expect(page.text()).not.toContain('申请已批准');
  expect(visible<HTMLTextAreaElement>('textarea')[0]!.value).toBe('待核对裁定'); expect(f.writes()).toHaveLength(1);
  await page.reread(); expect(visible<HTMLTextAreaElement>('textarea[readonly]')[0]!.value).toBe('待核对裁定');
  expect(page.text()).toContain('审批结果以最新申请记录为准'); expect(f.writes()).toHaveLength(1);
});

test('读取被拒绝时输入副本可见但旧申请不能继续裁定；恢复后仍是同一份输入', async () => {
  const f = adminRequestPagesFixture(); page = await renderApp('/admin/requests');
  await type(visible<HTMLTextAreaElement>('textarea')[0]!, '核对副本'); f.state.apiError = 403;
  await page.reread(); expect(page.text()).toContain('API 分页读取失败');
  expect(visible<HTMLButtonElement>('button').filter((b) => b.textContent === '批准')).toHaveLength(0);
  expect(visible<HTMLTextAreaElement>('textarea[readonly]')[0]!.value).toBe('核对副本');
  f.state.apiError = 0; await page.reread(); expect(visible<HTMLTextAreaElement>('textarea')[0]!.value).toBe('核对副本');
  f.apiRequests[0]!.state = 'rejected'; await page.reread();
  expect(visible<HTMLTextAreaElement>('textarea[readonly]')[0]!.value).toBe('核对副本');
  await click('清除这条意见'); await page.navigate('/admin'); expect(page.path()).toBe('/admin'); expect(f.writes()).toHaveLength(0);
});

test('当前行可进入项目申请范围；改变项目清除游标，浏览器返回仍保护当前意见', async () => {
  const f = adminRequestPagesFixture(), path = '/admin/requests?apiCursor=api%3A20';
  const history = browserHistoryFixture([path]); page = await renderApp(path, undefined, history.history);
  const projectId = f.apiRequests[20]!.projectId; await page.click('查看此项目申请');
  expect(page.search()).toMatchObject({ projectId }); expect(page.search().apiCursor).toBeUndefined();
  const last = f.calls.filter((c) => c.url.pathname === '/v1/api-requests/page').at(-1)!;
  expect(last.url.searchParams.get('projectId')).toBe(projectId); expect(last.url.searchParams.has('cursor')).toBe(false);
  await type(visible<HTMLTextAreaElement>('textarea')[0]!, '项目范围意见'); await page.back();
  expect(page.search().projectId).toBe(projectId); expect(page.text()).toContain('审批意见有未保存的输入');
  await page.click('继续编辑'); expect(visible<HTMLTextAreaElement>('textarea')[0]!.value).toBe('项目范围意见');
  await page.click('查看所有项目'); await page.click('放弃输入并离开'); expect(page.search().projectId).toBeUndefined();
  expect(page.search().apiCursor).toBeUndefined(); expect(f.writes()).toHaveLength(0);
});

// 2026-09-23 裁定：没有刷新按钮。申请每 30 秒先核对身份再静默重读（回到前台立即补一次，定时器走同一路径）；
// 例行重读不暂停裁定，批准按钮不会每 30 秒变灰一次。
test('申请自动重读：先核对身份，重读在途时批准按钮仍可用', async () => {
  const f = adminRequestPagesFixture(); page = await renderApp('/admin/requests');
  const reads = () => f.calls.filter((c) => c.url.pathname === '/v1/api-requests/page').length, identity = () => f.calls.filter((c) => c.url.pathname === '/v1/me').length;
  const before = reads(), me = identity(), fixture = globalThis.fetch; let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (raw, init) => { if (String(raw).includes('/v1/api-requests/page')) await held; return fixture(raw, init); }) as typeof fetch;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await page.settle();
  expect(identity()).toBeGreaterThan(me);
  expect(visible<HTMLButtonElement>('button').find((b) => b.textContent === '批准')?.disabled).toBe(false);
  await act(async () => release()); await page.settle();
  expect(reads()).toBe(before + 1); expect(f.writes()).toHaveLength(0);
});
