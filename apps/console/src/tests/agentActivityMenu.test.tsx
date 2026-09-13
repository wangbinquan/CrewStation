import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useSearch } from '@tanstack/react-router';
import { AppRoot } from '../app/layout/AppRoot';
import { AgentActivityMenu } from '../app/layout/activity/AgentActivityMenu';
import { messages } from '../app/i18n/zh-CN';
import { activityFixture, activityProjectId, activityTaskId, activityUserId, activityTime } from './agentActivityFixture';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; globalThis.fetch = originalFetch; });

function Probe() { const search = useSearch({ strict: false }); return <><AgentActivityMenu /><output aria-label="定位参数">{JSON.stringify(search)}</output></>; }
async function fixture() {
  const f = activityFixture(), calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input); calls.push(url); let body: unknown = {};
    if (url.endsWith('/v1/me')) body = { id: activityUserId, name: '开发者', memberships: [] };
    else if (url.endsWith('/dev-session')) body = { taskId: activityTaskId, state: 'running' };
    else if (url.includes('/agent-activity')) body = f.page;
    else if (url.endsWith('/agent-terminals')) body = f.roster;
    else body = { name: '动态验收应用' };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const root = createRootRoute({ component: AppRoot });
  const route = createRoute({ getParentRoute: () => root, path: '/projects/$projectId/dev-session', component: Probe, validateSearch: (search) => search });
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${activityProjectId}/dev-session`] }) });
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
