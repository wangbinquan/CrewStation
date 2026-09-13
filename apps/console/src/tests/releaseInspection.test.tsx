import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReleaseControl } from '../features/dev-session/components/ReleaseControl';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { messages as appMessages } from '../app/i18n/zh-CN';
import { api } from '../shared/api/client';
import { useApiMutation } from '../shared/api/useApi';
import { I18nProvider } from '../shared/lib/I18nProvider';

const taskId = 'tsk_0123456789abcdef0123456789abcdef';
const cleanups: Array<() => void> = [];
const requests: string[] = [];
let response: unknown;
let waitForResponse: Promise<void> | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); requests.length = 0; globalThis.fetch = originalFetch; waitForResponse = undefined; });

function Control(): ReactElement {
  const release = useApiMutation((force: boolean) => api.devSession.release('prj_test', { force }));
  return <ReleaseControl projectId="prj_test" taskId={taskId} access={{ isOwner: true, isMine: true, canRelease: true, needsForce: false }} release={release} />;
}

async function renderControl() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
    await waitForResponse;
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const catalog = { 'zh-CN': { ...appMessages, ...messages }, 'en-US': messages };
  await act(async () => root.render(<QueryClientProvider client={client}><I18nProvider catalog={catalog}><Control /></I18nProvider></QueryClientProvider>));
  cleanups.push(() => { act(() => root.unmount()); host.remove(); client.clear(); });
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
  const button = (label: string) => [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;
  return { text: () => host.textContent ?? '', button, settle, click: async (label: string) => { await act(async () => button(label).click()); await settle(); } };
}

test('释放前展示具体 dirty 文件和未推送提交；取消不 DELETE，再次展开重新检查', async () => {
  response = {
    status: 'ready', taskId, branch: 'main', headSha: 'a'.repeat(40), checkedAt: '2026-09-13T00:00:00.000Z',
    uncommitted: [{ path: '待保存.txt', index: '.', worktree: 'M' }], uncommittedCount: 1,
    unpushed: { status: 'ready', count: 1, commits: [{ sha: 'b'.repeat(40), subject: '尚未推送的首页' }] },
  };
  const ui = await renderControl();
  expect(requests).toHaveLength(0);
  await ui.click('释放会话');
  expect(ui.text()).toContain('待保存.txt');
  expect(ui.text()).toContain('尚未推送的首页');
  expect(requests).toEqual(['GET /v1/projects/prj_test/dev-session/workspace-status']);
  await ui.click('取消');
  expect(requests.every((request) => request.startsWith('GET'))).toBe(true);
  await ui.click('释放会话');
  expect(requests).toHaveLength(2);
});

test('检查 pending 时不能确认；检查未知后仍可显式释放且文案不冒充安全', async () => {
  let resolve: (() => void) | undefined;
  waitForResponse = new Promise<void>((done) => { resolve = done; });
  response = { status: 'unavailable', taskId, reason: '开发容器未连接', checkedAt: '2026-09-13T00:00:00.000Z' };
  const ui = await renderControl();
  await ui.click('释放会话');
  expect(ui.button('确认释放').disabled).toBe(true);
  await act(async () => resolve?.());
  await ui.settle();
  expect(ui.text()).toContain('工作树状态未知：开发容器未连接');
  expect(ui.text()).not.toContain('没有未推送');
  expect(ui.button('确认释放').disabled).toBe(false);
  await ui.click('确认释放');
  expect(requests.some((request) => request.startsWith('DELETE'))).toBe(true);
});

test('预检返回另一个会话时不能沿用旧确认释放', async () => {
  response = { status: 'unavailable', taskId: 'tsk_other', reason: '重新连接中', checkedAt: '2026-09-13T00:00:00.000Z' };
  const ui = await renderControl();
  await ui.click('释放会话');
  expect(ui.text()).toContain('开发会话已变化');
  expect(ui.button('确认释放').disabled).toBe(true);
});
