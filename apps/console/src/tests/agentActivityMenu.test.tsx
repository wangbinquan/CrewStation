import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Link, RouterProvider, useSearch } from '@tanstack/react-router';
import { AppRoot } from '../app/layout/AppRoot';
import { AgentActivityMenu } from '../app/layout/activity/AgentActivityMenu';
import { messages } from '../app/i18n/zh-CN';
import { activityFixture, activityProjectId, activityTaskId, activityUserId, activityTime } from './agentActivityFixture';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; globalThis.fetch = originalFetch; });

function Probe() { const search = useSearch({ strict: false }); return <><Link to="/admin">验收总览</Link><AgentActivityMenu /><output aria-label="定位参数">{JSON.stringify(search)}</output></>; }
async function fixture(admin = false) {
  const f = activityFixture(), calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); calls.push(url); let body: unknown = {};
    if (url.endsWith('/v1/me')) body = { id: activityUserId, name: '开发者', memberships: [], isAdmin: admin };
    else if (url.endsWith('/dev-session')) body = { taskId: activityTaskId, state: 'running' };
    else if (url.includes('/agent-activity')) body = f.page;
    else if (url.endsWith('/agent-terminals')) body = f.roster;
    else body = { name: '动态验收应用', kind: admin ? 'APIProxy' : 'DigitalWorker' };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const root = createRootRoute({ component: AppRoot });
  const route = createRoute({ getParentRoute: () => root, path: '/projects/$projectId/dev-session', component: Probe, validateSearch: (search) => search });
  const adminRoute = createRoute({ getParentRoute: () => root, path: '/admin/integrations/$projectId/dev-session', component: Probe, validateSearch: (search) => search });
  const overview = createRoute({ getParentRoute: () => root, path: '/admin', component: Probe });
  const router = createRouter({ routeTree: root.addChildren([route, adminRoute, overview]), history: createMemoryHistory({ initialEntries: [`${admin ? '/admin/integrations' : '/projects'}/${activityProjectId}/dev-session`] }) });
  rendered = await renderElement(<RouterProvider router={router} />, messages);
  return { ...f, calls, router };
}

test('全局入口显示后台等待，关闭返回按钮；前往处理传递完整身份且菜单本身不答复或标记', async () => {
  const f = await fixture();
  await rendered!.click('Agent 动态待处理 1');
  expect(rendered!.text()).toContain('等待回答'); expect(rendered!.text()).toContain('动态验收应用');
  await rendered!.click('关闭');
  expect(document.activeElement?.textContent).toBe('Agent 动态待处理 1');
  await rendered!.click('Agent 动态待处理 1'); await rendered!.click('前往处理');
  expect(f.router.state.location.search).toMatchObject({ task: activityTaskId, agent: f.terminal.agentId, terminal: f.terminal.terminalId, turn: 'turn-one', event: 'event-question', seq: 3 });
  expect(f.router.state.location.search.focus).toBeString();
  expect(f.calls.some((url) => url.endsWith('/read'))).toBe(false);
  expect(rendered!.text()).not.toContain('查看只标记本人已读');
});

test('管理接入容器的动态离开项目后仍保留，前往处理回到管理 CLI', async () => {
  const f = await fixture(true);
  await act(async () => { rendered!.host.querySelector<HTMLAnchorElement>('a[href="/admin"]')!.click(); }); await rendered!.settle();
  expect(f.router.state.location.pathname).toBe('/admin');
  await rendered!.click('Agent 动态待处理 1'); await rendered!.click('前往处理');
  expect(f.router.state.location.pathname).toBe(`/admin/integrations/${activityProjectId}/dev-session`);
  expect(f.router.state.location.search).toMatchObject({ task: activityTaskId, agent: f.terminal.agentId, event: 'event-question', seq: 3 });
  expect(f.calls.some((url) => url.endsWith('/read'))).toBe(false);
});

test('较早未读使用独立向前游标，不把历史结果当作当前轮次', async () => {
  const f = await fixture();
  f.page.previousCursor = 20; f.page.unread = [{ agentId: f.terminal.agentId, completions: 2, issues: 0 }];
  f.page.items = [{ eventId: 'old-result', agentId: f.terminal.agentId, terminalId: f.terminal.terminalId, runnerId: f.terminal.runnerId, seq: 20, turnId: 'old-turn', kind: 'turn-completed', occurredAt: activityTime, unread: true }];
  await rendered!.click('Agent 动态待处理 1'); await rendered!.click('刷新');
  expect(rendered!.text()).toContain('等待回答'); expect(rendered!.text()).toContain('本轮完成');
  await rendered!.click('更早未读');
  expect(f.calls.some((url) => url.includes('unread=true') && url.includes('before=20'))).toBe(true);
  expect(rendered!.text()).toContain('回到最新');
});

test('翻页在途关闭菜单，迟到的历史响应不改变再次打开的最新动态', async () => {
  const f = await fixture(); f.page.previousCursor = 20;
  await rendered!.click('Agent 动态待处理 1'); await rendered!.click('刷新');
  const fetchLatest = globalThis.fetch;
  let finish!: (response: Response) => void;
  globalThis.fetch = (async (input, init) => String(input).includes('before=20') ? new Promise<Response>((resolve) => { finish = resolve; }) : fetchLatest(input, init)) as typeof fetch;
  await rendered!.click('更早未读'); await rendered!.click('关闭');
  await act(async () => { finish(new Response(JSON.stringify({ ...f.page, previousCursor: 10 }), { headers: { 'content-type': 'application/json' } })); });
  await rendered!.settle(); await rendered!.click('Agent 动态待处理 1');
  // 关闭会清除历史选择；在途响应曾把旧页重新装回，掩盖最新结果。
  expect(rendered!.text()).not.toContain('回到最新');
  expect(Array.from(rendered!.host.querySelectorAll('button')).find((button) => button.textContent === '更早未读')?.disabled).toBe(false);
  expect(rendered!.text()).toContain('等待回答');
});
