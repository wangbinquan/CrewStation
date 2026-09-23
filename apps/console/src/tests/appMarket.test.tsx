import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AppVisibilityDto, MarketAppDto, UserId } from '@crewstation/contracts';
import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const userId = '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId, projectId = '01a0bf5d-8f4b-7aef-84b8-c458233bab22';
const user = { userId, name: '小林', email: 'lin@example.com' };
const app = (overrides: Partial<MarketAppDto> = {}): MarketAppDto => ({
  projectId: projectId as MarketAppDto['projectId'], name: '知识助理', icon: 'book', description: '整理团队知识',
  owner: { userId, name: '应用负责人' }, projectState: 'active', canPreview: false, entry: { kind: 'production', status: 'unavailable' }, canDevelop: false, canConfigure: false, visibilityRevision: 1,
  production: { status: 'not-deployed', freshness: 'current', checkedAt: '2026-09-13T00:00:00.000Z' }, checkedAt: '2026-09-13T00:00:00.000Z', ...overrides,
});
let saved: AppVisibilityDto;
function fixture(owner = false, application = app()) {
  saved = { mode: 'members', userIds: [], users: [], revision: 0, updatedAt: null, canConfigure: owner };
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  let conflict = false, queryFailure = false, marketFailure = false, slowReload = false, holdMarket: Promise<void> | undefined;
  globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = String(raw), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    let result: unknown = { items: [] }, status = 200;
    if (url.endsWith('/v1/me')) result = { id: userId, name: '使用者', email: 'user@example.com', platformRole: owner ? 'developer' : 'user', isAdmin: false, memberships: owner ? [{ projectId, role: 'owner' }] : [], authMethod: 'password' as const };
    else if (url.includes('/market/apps')) {
      if (holdMarket) await holdMarket;
      if (marketFailure) { result = { error: 'not_found', message: '应用不存在或不可见' }; status = 404; }
      else result = url.includes(`/apps/${projectId}`) ? application : { items: [application] };
    } else if (url.endsWith('/app-visibility')) {
      if (method === 'PUT' && conflict) { saved = { ...saved, mode: 'selected', userIds: [userId], users: [user], revision: 2 }; result = { error: 'conflict', message: '其他负责人已更新' }; status = 409; }
      else if (method === 'GET' && queryFailure) { result = { error: 'unavailable', message: '暂时无法读取设置' }; status = 503; }
      else if (method === 'GET' && slowReload) { await new Promise((resolve) => setTimeout(resolve, 300)); result = saved; }
      else { if (body) saved = { ...saved, ...body, revision: Number(body.expectedRevision) + 1 }; result = saved; }
    } else if (url.endsWith('/app-presentation')) result = { description: '整理团队知识', icon: 'book', revision: saved.revision, updatedAt: null };
    else if (url.includes('/member-candidates')) result = { items: [user] };
    return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, conflict: (value: boolean) => { conflict = value; }, queryFailure: () => { queryFailure = true; }, revoke: () => { marketFailure = true; }, slowReload: () => { slowReload = true; },
    /** 扣住市场回执，返回放行函数：用来断言例行刷新在途时页面上还剩什么。 */
    hold: () => { let open = () => {}; holdMarket = new Promise<void>((resolve) => { open = () => { holdMarket = undefined; resolve(); }; }); return open; } };
}
async function input(node: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    node.focus();
    const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.settle();
}
const scopeSelect = () => document.querySelector<HTMLSelectElement>('form select option[value="members"]')!.parentElement as HTMLSelectElement;

describe('能力市场与负责人设置真实路由', () => {
  test('首页是业务卡片，不可用应用没有详情或打开入口，不请求项目内部数据', async () => {
    const f = fixture(); page = await renderApp('/');
    expect(page.text()).toContain('知识助理'); expect(page.text()).toContain('暂不可用');
    expect(page.text()).not.toContain('进入项目'); expect(page.text()).not.toContain('打开正式应用');
    expect(document.querySelector(`a[href="/market/${projectId}"]`)).toBeNull();
    expect([...document.querySelectorAll('main a')].some((a) => a.textContent?.includes('知识助理'))).toBe(false);
    expect(page.text()).not.toContain('当前项目'); expect(page.html()).not.toContain('preview.');
    expect(f.calls.some((call) => call.url.includes('/v1/projects'))).toBe(false);
  });
  test('市场自动校验被撤销时移除旧应用，不以空态隐藏查询错误', async () => {
    const f = fixture(); page = await renderApp('/market');
    expect(page.text()).toContain('知识助理'); f.revoke();
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
    expect(page.text()).not.toContain('知识助理'); expect(page.text()).toContain('应用不存在或不可见'); expect(page.text()).not.toContain('暂无可见应用');
    expect(page.text()).toContain('重新查询');
  });
  test('已上线应用独立打开，负责人也没有项目编辑入口或提交信息', async () => {
    fixture(true, app({ canDevelop: true, canConfigure: true, entry: { kind: 'production', status: 'ready', host: 'knowledge.example.test' }, production: { status: 'deployed', state: 'ready', host: 'knowledge.example.test', tag: 'v1.2.3', commitSha: 'abc123', freshness: 'current', checkedAt: '2026-09-13T00:00:00.000Z' } }));
    page = await renderApp('/market');
    const link = document.querySelector<HTMLAnchorElement>('a[href="http://knowledge.example.test"]');
    expect(link?.target).toBe('_blank'); expect(page.text()).not.toContain('abc123');
    // 卡片标题曾跳到技术详情页；名称现在就是应用主页的原生链接。
    expect(link?.textContent).toBe('知识助理'); expect(link?.closest('h2')).not.toBeNull();
    expect(document.querySelector(`a[href="/market/${projectId}"]`)).toBeNull();
    expect(page.text()).not.toContain('应用详情'); expect(page.text()).not.toContain('负责人：');
    expect(page.text()).not.toContain('进入项目'); expect(page.text()).not.toContain('配置可见性');
    expect(page.html()).not.toContain(`/projects/${projectId}/settings`);
  });
  test('项目不是已开通状态时保留正式版本记录，不能同时显示在线与正式打开入口', async () => {
    fixture(false, app({ projectState: 'failed', production: { status: 'deployed', state: 'ready', host: 'knowledge.example.test', tag: 'v1.2.3', commitSha: 'abc123', freshness: 'current', checkedAt: '2026-09-13T00:00:00.000Z' } }));
    page = await renderApp('/market');
    expect(page.text()).toContain('暂不可用');
    expect(page.text()).not.toContain('已上线'); expect(page.text()).not.toContain('打开正式应用');
  });
  test('旧详情书签替换到能力市场，不再加载单应用详情', async () => {
    const f = fixture(); page = await renderApp(`/market/${projectId}`);
    expect(page.path()).toBe('/market'); expect(page.text()).toContain('知识助理');
    expect(page.text()).not.toContain('应用详情');
    expect(f.calls.some((call) => call.url.includes(`/apps/${projectId}`))).toBe(false);
  });
  test('即使响应声称可用，缺失或无效应用地址也不能生成打开链接', async () => {
    const application = app({ entry: { kind: 'production', status: 'ready', host: 'javascript:alert(1)' }, description: '' });
    fixture(false, application); page = await renderApp('/market');
    expect(document.querySelector('main a')).toBeNull(); expect(page.text()).toContain('暂不可用');
    expect(page.text()).not.toContain('负责人尚未填写');
  });
  test('指定名单约束首屏展示；空名单字段错误；精确查找去重与取消不保存', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`); await page.click('修改可见范围');
    await input(scopeSelect(), 'selected');
    expect(page.text()).toContain('至少选择一位，最多 200 位'); await page.click('保存可见范围');
    expect(page.text()).toContain('请至少选择一位已注册用户'); expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    await input(document.querySelector<HTMLInputElement>('input')!, 'lin@example.com'); await page.click('查找账号');
    await page.click('加入指定名单'); await page.click('加入指定名单');
    expect(document.querySelectorAll('ul.people li')).toHaveLength(1);
    await page.click('取消修改'); expect(scopeSelect().value).toBe('selected'); await page.click('放弃这份修改');
    expect(document.querySelector('form select option[value="members"]')).toBeNull(); expect(page.text()).toContain('项目成员'); expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });
  test('并发保存保留草稿和最新范围，显式采用最新修订后再次保存', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`); await page.click('修改可见范围');
    await input(scopeSelect(), 'authenticated'); f.conflict(true); await page.click('保存可见范围');
    expect(scopeSelect().value).toBe('authenticated'); expect(page.text()).toContain('本地草稿已保留'); expect(page.text()).toContain('第 2 版');
    f.conflict(false); await page.click('使用最新修订，保留本地草稿');
    expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    await page.click('保存可见范围');
    expect(f.calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ mode: 'authenticated', userIds: [], expectedRevision: 2 });
    expect(document.querySelector('form select option[value="members"]')).toBeNull(); expect(page.text()).toContain('全部登录用户');
  });
  test('最新设置读取失败时保留已经输入的草稿，不能把表单卸载清空', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`); await page.click('修改可见范围');
    await input(scopeSelect(), 'authenticated'); f.queryFailure(); await page.click('读取最新设置');
    expect(page.text()).toContain('暂时无法读取设置'); expect(scopeSelect().value).toBe('authenticated');
  });
});

describe('保存后的后台重读', () => {
  test('保存成功后重读设置期间不显示“暂不能保存”，成功提示与最新修订保留', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`); await page.click('修改可见范围');
    await input(scopeSelect(), 'authenticated'); f.slowReload(); await page.click('保存可见范围');
    expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(page.text()).toContain('已保存'); expect(page.text()).not.toContain('暂不能保存');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); }); await page.settle();
    expect(page.text()).toContain('已保存第 1 版'); expect(page.text()).not.toContain('暂不能保存'); expect(page.text()).toContain('全部登录用户');
  });
  test('例行刷新在途保留当前卡片，回执到达后原地替换，不卸载整片网格', async () => {
    const f = fixture(); page = await renderApp('/market');
    const card = () => document.querySelector('main h2'), before = card();
    expect(page.text()).toContain('知识助理');
    const release = f.hold();
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
    expect(f.calls.filter((call) => call.url.includes('/market/apps'))).toHaveLength(2);
    // 刷新在途：卡片还在，且是同一批 DOM 节点，不是清空后重挂。
    expect(page.text()).toContain('知识助理'); expect(page.text()).not.toContain('载入中'); expect(card()).toBe(before);
    await act(async () => release()); await page.settle();
    expect(page.text()).toContain('知识助理'); expect(card()).toBe(before);
  });
});

describe('维护中的应用（RFC-021）', () => {
  // RFC-021 M13：维护中的应用带「维护中」与原因、预计恢复时间；被网关拦住的人没有打开入口，放行的人照常打开。
  test('正式版本维护中：卡片标注维护与原因；被拦住的人没有打开链接，放行的人照常打开', async () => {
    const deployed = { entry: { kind: 'production' as const, status: 'ready' as const, host: 'knowledge.example.test' }, production: { status: 'deployed' as const, state: 'ready' as const, host: 'knowledge.example.test', tag: 'v1.2.3', commitSha: 'abc123', freshness: 'current' as const, checkedAt: '2026-09-13T00:00:00.000Z' } };
    fixture(false, app({ ...deployed, maintenance: { reason: '迁移订单表', expectedEndAt: '2026-09-13T04:00:00.000Z', blocked: true } }));
    page = await renderApp('/market');
    expect(page.text()).toContain('维护中'); expect(page.text()).toContain('维护中：迁移订单表'); expect(page.text()).toContain('预计'); expect(page.text()).toContain('维护中，暂不可用');
    expect(document.querySelector('a[href="http://knowledge.example.test"]')).toBeNull();
    page.unmount();
    fixture(false, app({ ...deployed, maintenance: { reason: '迁移订单表', blocked: false } }));
    page = await renderApp('/market');
    expect(page.text()).toContain('维护中：迁移订单表'); expect(page.text()).not.toContain('维护中，暂不可用');
    expect(document.querySelector('a[href="http://knowledge.example.test"]')?.textContent).toBe('知识助理');
  });
});
