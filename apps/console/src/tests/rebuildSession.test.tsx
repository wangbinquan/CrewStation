import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import { EditorView } from '@codemirror/view';
import type { DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';
import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { activityProjectId, activityTaskId, activityTime } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; focusManager.setFocused(undefined); });
function setup() {
  const f = editorWorkspaceFixture(); fixture = f; f.sessionState.state = 'failed'; f.sessionState.message = 'OOMKilled';
  const fetch = globalThis.fetch, sent: RebuildDevSessionRequest[] = [];
  const check: DevSessionRebuildInspection = { taskId: TaskIdSchema.parse(activityTaskId), projectId: ProjectIdSchema.parse(activityProjectId), updatedAt: activityTime, podUid: 'old-pod', volume: { uid: 'kept-pvc', capacity: '10Gi' }, currentProfile: 'medium',
    profiles: [{ name: 'medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }, { name: 'large', cpu: '2', memory: '4Gi', storage: '20Gi', description: '' }], checkedAt: activityTime };
  const state = { checkError: false, loseResponse: false, blocked: false, failedKind: '' };
  let finish: (() => void) | undefined;
  globalThis.fetch = (async (raw, init) => {
    if (!String(raw).endsWith('/dev-session/rebuild')) return fetch(raw, init);
    if (init?.method !== 'POST') return state.checkError ? Response.json({ error: 'unavailable', message: '原工作卷检查失败' }, { status: 503 }) : Response.json(check);
    const input = JSON.parse(String(init.body)) as RebuildDevSessionRequest; sent.push(input);
    if (state.blocked) await new Promise<void>((resolve) => { finish = resolve; });
    if (state.failedKind) return Response.json({ error: state.failedKind, message: '管理员套餐已变化，请重新检查' }, { status: 409 });
    if (state.loseResponse) return Response.json({ error: 'unavailable', message: '暂未收到恢复回执' }, { status: 503 });
    f.sessionState.state = 'creating';
    f.sessionState.rebuild = { requestId: input.requestId, taskId: TaskIdSchema.parse(activityTaskId), profile: input.profile, state: 'queued', createdAt: activityTime, updatedAt: activityTime };
    return Response.json(f.sessionState.rebuild, { status: 202 });
  }) as typeof fetch;
  return { f, sent, state, check, finish: () => finish?.() };
}

test('恢复检查、取消和失败保留原工作区；任务套餐在确认前完整可见', async () => {
  const { state, sent } = setup(); page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  expect(page.text()).toContain('检查并恢复原工作树'); expect(page.text()).not.toContain('选一个远端分支');
  state.checkError = true; await page.click('检查并恢复原工作树'); expect(page.text()).toContain('原工作卷检查失败'); expect(sent).toHaveLength(0);
  state.checkError = false; await page.click('检查并恢复原工作树');
  expect(page.text()).toContain('kept-pvc'); expect(page.text()).toContain('10Gi'); expect(page.text()).toContain('原 CLI 已结束');
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="环境资源套餐"]')!; expect(document.activeElement).toBe(select); expect(select.value).toBe('medium');
  await page.click('保留当前工作区'); expect(sent).toHaveLength(0); expect(document.activeElement?.textContent).toBe('检查并恢复原工作树');
});

test('重复确认只发一次，超时重试保持原请求与套餐，202 后显示排队并保留编辑草稿', async () => {
  const { f, sent, state, finish } = setup(); f.sessionState.state = 'running'; page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  await page.click('代码'); await page.click('a.ts'); const editor = document.querySelector<HTMLElement>('.cm-content')!, view = EditorView.findFromDOM(editor)!;
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '恢复前的未保存草稿' } }));
  f.sessionState.state = 'failed'; await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  await page.click('检查并恢复原工作树'); const select = document.querySelector<HTMLSelectElement>('select[aria-label="环境资源套餐"]')!;
  await act(async () => { select.value = 'large'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  state.blocked = true; state.loseResponse = true;
  const confirm = [...document.querySelectorAll('button')].find((node) => node.textContent === '确认保留工作树重建')!;
  await act(async () => { confirm.click(); confirm.click(); }); await page.settle(); expect(sent).toHaveLength(1);
  await act(async () => finish()); await page.settle(); expect(page.text()).toContain('暂未收到恢复回执'); expect(select.disabled).toBe(true);
  state.blocked = false; state.loseResponse = false; await page.click('重试同一恢复请求');
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect(sent[0]?.profile).toEqual({ name: 'large', cpu: '2', memory: '4Gi', storage: '20Gi' });
  expect(page.text()).toContain('恢复已排队'); expect(page.text()).not.toContain('原工作树已恢复');
  expect(document.querySelector('.cm-content')).toBe(editor); expect(editor.textContent).toBe('恢复前的未保存草稿');
  expect(f.commands.some((command) => ['startAgentTerminal', 'closeTerminal', 'stopAgent'].includes(command.type))).toBe(false);
  expect(f.writes.some((write) => write.method === 'DELETE')).toBe(false);
});

test('套餐变化或任务修订冲突必须重新检查，不能重发旧确认', async () => {
  const { state, check, sent } = setup(); page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  await page.click('检查并恢复原工作树'); state.failedKind = 'conflict'; await page.click('确认保留工作树重建'); expect(sent).toHaveLength(1);
  check.profiles[0]!.memory = '3Gi'; state.failedKind = ''; await page.click('重新检查恢复对象'); expect(page.text()).toContain('3Gi');
  await page.click('确认保留工作树重建'); expect(sent[1]?.requestId).not.toBe(sent[0]?.requestId); expect(sent[1]?.profile.memory).toBe('3Gi');
});

test('已受理恢复随后失败时直接重新检查，不锁在未知回执或重试旧请求', async () => {
  const { f, sent } = setup(); page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  await page.click('检查并恢复原工作树'); await page.click('确认保留工作树重建');
  f.sessionState.state = 'failed'; f.sessionState.rebuild!.state = 'failed'; f.sessionState.rebuild!.message = 'CPU 不足，原卷保留';
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  // 实机 Pending 超时后已得到失败结果，不能继续告诉用户回执未知并重放永久失败的请求。
  expect(page.text()).toContain('CPU 不足，原卷保留'); expect(page.text()).not.toContain('暂未确认恢复结果');
  await page.click('重新检查恢复对象');
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="环境资源套餐"]')?.disabled).toBe(false);
  await page.click('确认保留工作树重建'); expect(sent[1]?.requestId).not.toBe(sent[0]?.requestId);
});
