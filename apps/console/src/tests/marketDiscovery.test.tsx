import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { MarketAppDto, UserId } from '@crewstation/contracts';
import { marketHistory, parseMarketSearch } from '../features/capabilities/model/marketSearch';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
const userId = '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId;
const ownerId = '01a0bf5d-8f4b-7f8b-8136-e631380738b1' as UserId;
const now = '2026-09-27T00:00:00.000Z';
function fixture() {
  const items: MarketAppDto[] = Array.from({ length: 30 }, (_, index) => ({
    projectId: `01a0bf5d-8f4b-7aef-84b8-${String(index).padStart(12, '0')}` as MarketAppDto['projectId'], name: `知识应用${index + 1}`, description: `检索文档 ${index + 1}。` + (index === 29 ? '完整的长描述。'.repeat(80) : ''), icon: 'book',
    owner: { userId: index % 2 ? ownerId : userId, name: index % 2 ? '林晓' : '陈明' }, projectState: 'active', canPreview: false, canDevelop: false, canConfigure: false, visibilityRevision: 1,
    entry: { kind: 'production', status: 'ready', host: `app${index}.example.test` }, production: { status: 'deployed', tag: 'v1', commitSha: 'a', host: `app${index}.example.test`, state: 'ready', freshness: 'current', checkedAt: now }, checkedAt: now,
  }));
  const state = { items, fail: false, emptyContinuation: false, actorId: userId }, calls: URL[] = [];
  globalThis.fetch = (async (raw: RequestInfo | URL) => {
    const url = new URL(String(raw), 'http://localhost');
    if (url.pathname === '/v1/me') return Response.json({ id: state.actorId, name: '使用者', email: 'user@test.invalid', platformRole: 'user', isAdmin: false, memberships: [], authMethod: 'password' });
    if (url.pathname === '/v1/market/apps') {
      calls.push(url);
      if (state.fail) return Response.json({ error: 'unavailable', message: '市场查询失败' }, { status: 503 });
      if (state.emptyContinuation) return Response.json({ items: [], nextCursor: 'page-20' });
      const q = url.searchParams.get('q') ?? '', owner = url.searchParams.get('ownerId'), limit = Number(url.searchParams.get('limit') ?? 20), offset = Number((url.searchParams.get('cursor') ?? 'page-0').replace('page-', ''));
      const found = state.items.filter((item) => (!owner || item.owner.userId === owner) && q.split(/\s+/u).every((word) => `${item.name} ${item.description}`.includes(word)));
      return Response.json({ items: found.slice(offset, offset + limit), ...(found.length > offset + limit ? { nextCursor: `page-${offset + limit}` } : {}) });
    }
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, calls };
}
async function type(value: string) {
  const input = document.querySelector<HTMLInputElement>('main input')!;
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector)!;
  await act(async () => { button.focus(); button.click(); }); await page!.settle();
  return button;
}

test('负责人缺失信息回退、筛选与跨页关键词搜索发送到服务端，URL与后退还原条件', async () => {
  const f = fixture(); page = await renderApp('/market');
  expect(page.text()).toContain('项目负责人'); expect(document.querySelectorAll('tbody tr')).toHaveLength(20);
  await type('知识应用30 文档'); await page.click('搜索');
  expect(page.search().q).toBe('知识应用30 文档'); expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(f.calls.at(-1)?.searchParams.get('q')).toBe('知识应用30 文档');
  await page.click('林晓'); expect(page.search().ownerId).toBe(ownerId); expect(page.text()).toContain('负责人：林晓');
  expect(f.calls.at(-1)?.searchParams.get('ownerId')).toBe(ownerId);
  await click('button[aria-label="清除负责人筛选"]'); expect(page.search().ownerId).toBeUndefined(); expect(page.search().q).toBe('知识应用30 文档');
  await page.back(); expect(page.search().ownerId).toBe(ownerId);
  await page.click('清除筛选'); expect(page.search().q).toBeUndefined(); expect(page.search().ownerId).toBeUndefined();
  f.state.items[0]!.owner.name = ''; await page.reread(); expect(page.text()).toContain('负责人信息不可用'); expect(page.text()).not.toContain(userId);
});

test('翻页保留前页、分享游标可回首页，每页数量改变重置游标', async () => {
  fixture(); page = await renderApp('/market'); await page.click('下一页');
  expect(page.search().cursor).toBe('page-20'); expect(document.querySelectorAll('tbody tr')).toHaveLength(10);
  await page.click('上一页'); expect(page.search().cursor).toBeUndefined();
  await page.click('下一页');
  const select = document.querySelector<HTMLSelectElement>('main select')!;
  await act(async () => { select.value = '50'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  expect(page.search().limit).toBe(50); expect(page.search().cursor).toBeUndefined(); expect(document.querySelectorAll('tbody tr')).toHaveLength(30);
  page.unmount(); sessionStorage.clear(); page = await renderApp('/market?cursor=page-20');
  expect(page.text()).toContain('回到第一页'); await page.click('回到第一页'); expect(page.search().cursor).toBeUndefined();
});

test('长列表末行详情在统一弹窗中，关闭保留查询／分页／滚动并还原焦点', async () => {
  fixture(); page = await renderApp(`/market?limit=50&ownerId=${ownerId}&ownerName=林晓&q=文档`);
  const main = document.querySelector('main')!; main.scrollTop = 750;
  const trigger = await click('button[aria-label="查看知识应用30的详情"]');
  expect(document.querySelectorAll('dialog[data-cs-dialog]')).toHaveLength(1);
  expect(document.querySelector('dialog')?.textContent).toContain('完整的长描述。'.repeat(80));
  expect(document.querySelector('dialog')?.closest('tbody') === null).toBe(true);
  await act(async () => { document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); }); await page.settle();
  expect(document.querySelectorAll('dialog')).toHaveLength(0); expect(document.activeElement === trigger).toBe(true);
  expect(main.scrollTop).toBe(750); expect(page.search()).toMatchObject({ q: '文档', ownerId, limit: 50 });
});

test('失权、请求失败或身份变化撤下详情；恢复结果不会自动重开', async () => {
  const f = fixture(); page = await renderApp('/market'); await click('button[aria-label="查看知识应用1的详情"]');
  f.state.items = f.state.items.slice(1); await page.reread(); expect(document.querySelectorAll('dialog')).toHaveLength(0);
  await click('button[aria-label="查看知识应用2的详情"]'); f.state.fail = true; await page.reread();
  expect(document.querySelectorAll('dialog')).toHaveLength(0); expect(page.text()).toContain('市场查询失败'); expect(page.text()).not.toContain('知识应用2');
  f.state.fail = false; await page.reread(); expect(document.querySelectorAll('dialog')).toHaveLength(0);
  await click('button[aria-label="查看知识应用2的详情"]'); f.state.actorId = ownerId; await page.reread(); expect(document.querySelectorAll('dialog')).toHaveLength(0);
});

test('空分页保留下一页，空目录和无搜索结果分别提示', async () => {
  const f = fixture(); f.state.emptyContinuation = true; page = await renderApp('/market?q=目标');
  expect(page.text()).toContain('本页暂无可用应用'); expect(page.text()).toContain('下一页'); expect(page.text()).not.toContain('没有匹配的应用');
  f.state.emptyContinuation = false; f.state.items = []; await page.reread(); expect(page.text()).toContain('没有匹配的应用');
  await page.click('清除筛选'); expect(page.text()).toContain('暂无可见应用');
});

test('路由校验和分页历史按身份及完整条件隔离，失效存储不阻断浏览', () => {
  expect(parseMarketSearch({ q: '  文档\t检索 ', ownerId, limit: '50', ownerName: '林晓', ignored: 'x' })).toEqual({ q: '文档 检索', ownerId, limit: 50, ownerName: '林晓' });
  expect(parseMarketSearch({ ownerId: 'bad' })).toEqual({});
  const first = marketHistory(userId, { q: '文档' }); first.remember('next');
  expect(marketHistory(userId, { q: '文档', cursor: 'next' }).previous).toBe('');
  expect(marketHistory(ownerId, { q: '文档', cursor: 'next' }).previous).toBeUndefined();
  expect(marketHistory(userId, { q: '文档', limit: 50, cursor: 'next' }).previous).toBeUndefined();
  first.clear(); expect(marketHistory(userId, { q: '文档', cursor: 'next' }).previous).toBeUndefined();
});
