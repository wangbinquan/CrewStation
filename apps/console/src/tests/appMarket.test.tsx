import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import type { AppVisibilityDto, MarketAppDto, UserId } from '@crewstation/contracts';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const userId = `usr_${'a'.repeat(32)}` as UserId, projectId = `prj_${'b'.repeat(32)}`;
const user = { userId, name: '小林', email: 'lin@example.com' };
const app = (overrides: Partial<MarketAppDto> = {}): MarketAppDto => ({
  projectId: projectId as MarketAppDto['projectId'], name: '知识助理', icon: 'book', description: '整理团队知识',
  owner: { userId, name: '应用负责人' }, projectState: 'active', canDevelop: false, canConfigure: false, visibilityRevision: 1,
  production: { status: 'not-deployed', freshness: 'current', checkedAt: '2026-09-13T00:00:00.000Z' }, checkedAt: '2026-09-13T00:00:00.000Z', ...overrides,
});
let saved: AppVisibilityDto;
function fixture(owner = false, application = app()) {
  saved = { mode: 'members', userIds: [], users: [], revision: 0, updatedAt: null, canConfigure: owner };
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  let conflict = false, queryFailure = false, marketFailure = false, slowReload = false;
  globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = String(raw), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    let result: unknown = { items: [] }, status = 200;
    if (url.endsWith('/v1/me')) result = { id: userId, name: '使用者', email: 'user@example.com', isAdmin: false, memberships: owner ? [{ projectId, role: 'owner' }] : [], authMethod: 'password' as const };
    else if (url.includes('/market/apps')) {
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
  return { calls, conflict: (value: boolean) => { conflict = value; }, queryFailure: () => { queryFailure = true; }, revoke: () => { marketFailure = true; }, slowReload: () => { slowReload = true; } };
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
const scopeSelect = () => document.querySelector<HTMLSelectElement>('select option[value="members"]')!.parentElement as HTMLSelectElement;

describe('能力市场与负责人设置真实路由', () => {
  test('首页是市场，应用使用者不请求项目内部数据；详情不会展示项目导航', async () => {
    const f = fixture(); page = await renderApp('/');
    expect(page.text()).toContain('知识助理'); expect(page.text()).toContain('尚未上线');
    expect(page.text()).not.toContain('进入项目'); expect(page.text()).not.toContain('打开正式应用');
    await page.click('知识助理');
    expect(page.path()).toBe(`/market/${projectId}`);
    expect(page.text()).not.toContain('当前项目'); expect(page.html()).not.toContain('preview.');
    expect(f.calls.some((call) => call.url.includes('/v1/projects'))).toBe(false);
  });
  test('详情重新校验被撤销时移除旧应用，不以空态隐藏查询错误', async () => {
    const f = fixture(); page = await renderApp(`/market/${projectId}`);
    expect(page.text()).toContain('知识助理'); f.revoke(); await page.click('重新检查');
    expect(page.text()).not.toContain('知识助理'); expect(page.text()).toContain('应用不存在或不可见'); expect(page.text()).not.toContain('暂无可见应用');
    // 404 是明确状态而不是“读取失败”，说明可能原因并保留返回路径。
    expect(page.text()).toContain('该应用当前对你不可见'); expect(page.text()).not.toContain('读取失败'); expect(page.html()).toContain('href="/market"');
  });
  test('已上线的正式地址独立打开，只有建设者与负责人有相应快捷入口', async () => {
    fixture(true, app({ canDevelop: true, canConfigure: true, production: { status: 'deployed', state: 'ready', host: 'knowledge.example.test', tag: 'v1.2.3', commitSha: 'abc123', freshness: 'current', checkedAt: '2026-09-13T00:00:00.000Z' } }));
    page = await renderApp(`/market/${projectId}`);
    const link = document.querySelector<HTMLAnchorElement>('a[href="http://knowledge.example.test"]');
    expect(link?.target).toBe('_blank'); expect(page.text()).toContain('v1.2.3'); expect(page.text()).toContain('abc123');
    expect(page.text()).toContain('进入项目'); await page.click('配置可见性');
    expect(page.path()).toBe(`/projects/${projectId}/settings`);
  });
  test('暂停应用保留正式版本记录，不能同时显示在线与正式打开入口', async () => {
    fixture(false, app({ projectState: 'paused', production: { status: 'deployed', state: 'ready', host: 'knowledge.example.test', tag: 'v1.2.3', commitSha: 'abc123', freshness: 'current', checkedAt: '2026-09-13T00:00:00.000Z' } }));
    page = await renderApp(`/market/${projectId}`);
    expect(page.text()).toContain('已暂停'); expect(page.text()).toContain('正式版本');
    expect(page.text()).not.toContain('已上线'); expect(page.text()).not.toContain('打开正式应用');
  });
  test('指定名单约束首屏展示；空名单字段错误；精确查找去重与取消不保存', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`);
    await input(scopeSelect(), 'selected');
    expect(page.text()).toContain('至少选择一位，最多 200 位'); await page.click('保存可见范围');
    expect(page.text()).toContain('请至少选择一位已注册用户'); expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    await input(document.querySelector<HTMLInputElement>('input')!, 'lin@example.com'); await page.click('查找账号');
    await page.click('加入指定名单'); await page.click('加入指定名单');
    expect(document.querySelectorAll('ul.people li')).toHaveLength(1);
    await page.click('取消修改'); expect(scopeSelect().value).toBe('selected'); await page.click('放弃这份修改');
    expect(scopeSelect().value).toBe('members'); expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });
  test('并发保存保留草稿和最新范围，显式采用最新修订后再次保存', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`);
    await input(scopeSelect(), 'authenticated'); f.conflict(true); await page.click('保存可见范围');
    expect(scopeSelect().value).toBe('authenticated'); expect(page.text()).toContain('本地草稿已保留'); expect(page.text()).toContain('第 2 版');
    f.conflict(false); await page.click('使用最新修订，保留本地草稿');
    expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    await page.click('保存可见范围');
    expect(f.calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ mode: 'authenticated', userIds: [], expectedRevision: 2 });
    expect(scopeSelect().value).toBe('authenticated');
  });
  test('最新设置读取失败时保留已经输入的草稿，不能把表单卸载清空', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`);
    await input(scopeSelect(), 'authenticated'); f.queryFailure(); await page.click('读取最新设置');
    expect(page.text()).toContain('暂时无法读取设置'); expect(scopeSelect().value).toBe('authenticated');
  });
});

describe('保存后的后台重读', () => {
  test('保存成功后重读设置期间不显示“暂不能保存”，成功提示与最新修订保留', async () => {
    const f = fixture(true); page = await renderApp(`/projects/${projectId}/settings?tab=visibility`);
    await input(scopeSelect(), 'authenticated'); f.slowReload(); await page.click('保存可见范围');
    expect(f.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(page.text()).toContain('已保存'); expect(page.text()).not.toContain('暂不能保存');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); }); await page.settle();
    expect(page.text()).toContain('已保存第 1 版'); expect(page.text()).not.toContain('暂不能保存'); expect(scopeSelect().value).toBe('authenticated');
  });
});
