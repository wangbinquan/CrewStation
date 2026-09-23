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
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';

const taskId = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751';
const cleanups: Array<() => void> = [];
const requests: string[] = [];
let response: unknown;
let waitForResponse: Promise<void> | undefined;
const originalFetch = globalThis.fetch;
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); requests.length = 0; globalThis.fetch = originalFetch; waitForResponse = undefined; });

function Control(): ReactElement {
  const release = useApiMutation((force: boolean) => api.devSession.release('01a0bf5d-8f4b-708c-89b0-9c4412e78c07', { force }));
  return <ReleaseControl projectId="01a0bf5d-8f4b-708c-89b0-9c4412e78c07" taskId={taskId} access={{ isOwner: true, isMine: true, canRelease: true, needsForce: false }} release={release} />;
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
  expect(requests).toEqual(['GET /v1/projects/01a0bf5d-8f4b-708c-89b0-9c4412e78c07/dev-session/workspace-status']);
  await ui.click('取消');
  expect(requests.every((request) => request.startsWith('GET'))).toBe(true);
  await ui.click('释放会话');
  expect(requests).toHaveLength(2);
  // 工作区不干净：页内确认之后再弹窗，列出要丢的内容，输入 discard 才释放。
  await ui.click('确认释放');
  expect(openDialog().textContent).toContain('待保存.txt'); expect(openDialog().textContent).toContain('尚未推送的首页'); expect(openDialog().textContent).toContain('输入 discard 以确认');
  await typeConfirmWord('release'); expect(dialogConfirmButton().disabled).toBe(true); expect(requests.some((request) => request.startsWith('DELETE'))).toBe(false);
  await typeConfirmWord('discard'); await ui.click('丢弃并释放');
  expect(requests.filter((request) => request.startsWith('DELETE'))).toHaveLength(1); expect(document.querySelectorAll('dialog').length).toBe(0);
});

test('只有未推送的提交也算没保存：同样要输入 discard', async () => {
  response = {
    status: 'ready', taskId, branch: 'main', headSha: 'a'.repeat(40), checkedAt: '2026-09-13T00:00:00.000Z', uncommitted: [], uncommittedCount: 0,
    unpushed: { status: 'ready', count: 2, commits: [{ sha: 'b'.repeat(40), subject: '本地提交一' }, { sha: 'c'.repeat(40), subject: '本地提交二' }] },
  };
  const ui = await renderControl();
  await ui.click('释放会话'); await ui.click('确认释放');
  expect(openDialog().textContent).toContain('本地提交二'); expect(requests.some((request) => request.startsWith('DELETE'))).toBe(false);
  // 弹窗下面还压着页内确认面板，它也有「取消」；这里点弹窗自己的：只关弹窗，页内确认还在。
  await act(async () => { openDialog().querySelector<HTMLButtonElement>('button:not([type="submit"])')!.click(); }); await ui.settle();
  expect(document.querySelectorAll('dialog').length).toBe(0); expect(ui.text()).toContain('释放这个开发会话？');
});

test('工作区干净时沿用页内确认，直接释放，不弹窗', async () => {
  response = {
    status: 'ready', taskId, branch: 'main', headSha: 'a'.repeat(40), checkedAt: '2026-09-13T00:00:00.000Z', uncommitted: [], uncommittedCount: 0,
    unpushed: { status: 'ready', count: 0, commits: [] },
  };
  const ui = await renderControl();
  await ui.click('释放会话'); await ui.click('确认释放');
  expect(document.querySelectorAll('dialog').length).toBe(0);
  expect(requests.filter((request) => request.startsWith('DELETE'))).toHaveLength(1);
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
  // 检查不出结果按「没保存」处理：弹窗说明状态未知，输入 discard 才释放。
  await ui.click('确认释放');
  expect(openDialog().textContent).toContain('工作树状态未知：开发容器未连接'); expect(requests.some((request) => request.startsWith('DELETE'))).toBe(false);
  await typeConfirmWord('discard'); await ui.click('丢弃并释放');
  expect(requests.some((request) => request.startsWith('DELETE'))).toBe(true);
});

test('预检返回另一个会话时不能沿用旧确认释放', async () => {
  response = { status: 'unavailable', taskId: '01a0bf5d-8f4b-7063-8f17-997d0c19dced', reason: '重新连接中', checkedAt: '2026-09-13T00:00:00.000Z' };
  const ui = await renderControl();
  await ui.click('释放会话');
  expect(ui.text()).toContain('开发会话已变化');
  expect(ui.button('确认释放').disabled).toBe(true);
});
