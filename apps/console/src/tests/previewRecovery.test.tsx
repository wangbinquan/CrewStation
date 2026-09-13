import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { activityProjectId, activityTaskId } from './agentActivityFixture';
import { browserHistoryFixture } from './browserHistoryFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; });

test('预览崩溃仍能读代码，查看日志携带当前任务，返回不重启预览或 CLI', async () => {
  fixture = editorWorkspaceFixture(); Object.assign(fixture.preview, { state: 'crashed', lastError: '开发命令缺少配置' });
  const path = `/projects/${activityProjectId}/dev-session?view=preview`, history = browserHistoryFixture([path]), base = globalThis.fetch, calls: URL[] = [];
  globalThis.fetch = (async (raw, init) => { calls.push(new URL(String(raw), 'http://localhost')); return base(raw, init); }) as typeof fetch;
  page = await renderApp(path, undefined, history.history); expect(page.text()).toContain('开发命令缺少配置'); expect(page.text()).toContain('已崩溃');
  expect(document.querySelectorAll('iframe')).toHaveLength(0); await page.click('代码'); await page.click('a.ts'); expect(document.querySelector('.cm-content')?.textContent).toBe('磁盘原文');
  await page.click('预览'); await page.click('查看开发会话日志');
  expect(page.path()).toBe(`/projects/${activityProjectId}/operations`); expect(page.search()).toMatchObject({ tab: 'logs', source: 'dev-session', taskId: activityTaskId });
  expect(calls.some((url) => url.pathname.endsWith('/logs') && url.searchParams.get('source') === 'dev-session' && url.searchParams.get('taskId') === activityTaskId)).toBe(true);
  await page.back(); expect(page.search().view).toBe('preview'); expect(page.text()).toContain('开发命令缺少配置');
  expect(fixture.commands.some((c) => ['restartPreview', 'startAgentTerminal', 'stopAgentTerminal', 'writeFile'].includes(c.type))).toBe(false);
  expect(fixture.writes.every((write) => write.path.endsWith('/workspace-layout'))).toBe(true);
});

test('接入容器的预览日志始终保留管理空间和开发任务，不查询生产槽日志', async () => {
  fixture = editorWorkspaceFixture(); Object.assign(fixture.preview, { state: 'crashed', lastError: '代理开发服务启动失败' });
  const base = globalThis.fetch, calls: URL[] = [];
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'); calls.push(url); const response = await base(raw, init);
    if (url.pathname === '/v1/me') return Response.json({ ...await response.json(), isAdmin: true });
    if (url.pathname === `/v1/projects/${activityProjectId}`) return Response.json({ ...await response.json(), kind: 'APIProxy' });
    return response;
  }) as typeof fetch;
  page = await renderApp(`/admin/integrations/${activityProjectId}/dev-session?view=preview`); await page.click('查看开发会话日志');
  expect(page.path()).toBe(`/admin/integrations/${activityProjectId}/operations`);
  const logs = calls.filter((url) => url.pathname.endsWith('/logs')); expect(logs.length).toBeGreaterThan(0);
  expect(logs.every((url) => url.searchParams.get('source') === 'dev-session' && url.searchParams.get('taskId') === activityTaskId && !url.searchParams.has('slot'))).toBe(true);
  expect(fixture.commands.some((c) => c.type === 'restartPreview')).toBe(false);
});
