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
  const check: DevSessionRebuildInspection = { taskId: TaskIdSchema.parse(activityTaskId), projectId: ProjectIdSchema.parse(activityProjectId), updatedAt: activityTime, podUid: 'old-pod', volume: { uid: 'kept-pvc', capacity: '10Gi' }, currentProfile: '01a0bf5d-8f4b-7c08-8245-6a7766e23a18',
    profiles: [{ id: '01a0bf5d-8f4b-7c08-8245-6a7766e23a18', name: 'medium', cpu: '1', memory: '2Gi', storage: '10Gi', description: '' }, { id: '01a0bf5d-8f4b-7d35-8c41-6a85b807e9b5', name: 'large', cpu: '2', memory: '4Gi', storage: '20Gi', description: '' }], checkedAt: activityTime };
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
    f.sessionState.rebuild = { id: Bun.randomUUIDv7(), requestId: input.requestId, taskId: TaskIdSchema.parse(activityTaskId), profile: input.profile, state: 'queued', createdAt: activityTime, updatedAt: activityTime };
    return Response.json(f.sessionState.rebuild, { status: 202 });
  }) as typeof fetch;
  return { f, sent, state, check, finish: () => finish?.() };
}

test('恢复检查、取消和失败保留原工作区；任务套餐在确认前完整可见', async () => {
  const { state, sent } = setup(); page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  expect(page.text()).toContain('检查并恢复原工作树'); expect(page.text()).not.toContain('选一个远端分支');
  // 进来时就失败：整页状态卡，恢复卡紧跟在下面，不必先打开「会话与环境」面板（工作区等恢复后才出现，2026-09-23）。
  expect(document.querySelector('section[data-state="failed"]')).not.toBeNull(); expect(document.querySelector('[aria-label="工具面板"]')).toBeNull();
  state.checkError = true; await page.click('检查并恢复原工作树'); expect(page.text()).toContain('原工作卷检查失败'); expect(sent).toHaveLength(0);
  state.checkError = false; await page.click('检查并恢复原工作树');
  expect(page.text()).toContain('kept-pvc'); expect(page.text()).toContain('10Gi'); expect(page.text()).toContain('原 CLI 已结束');
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="环境资源套餐"]')!; expect(document.activeElement).toBe(select); expect(select.value).toBe('01a0bf5d-8f4b-7c08-8245-6a7766e23a18');
  await page.click('保留当前工作区'); expect(sent).toHaveLength(0); expect(document.activeElement?.textContent).toBe('检查并恢复原工作树');
});

test('重复确认只发一次，超时重试保持原请求与套餐，202 后显示排队并保留编辑草稿', async () => {
  const { f, sent, state, finish } = setup(); f.sessionState.state = 'running'; page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  await page.click('代码'); await page.click('a.ts'); const editor = document.querySelector<HTMLElement>('.cm-content')!, view = EditorView.findFromDOM(editor)!;
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '恢复前的未保存草稿' } }));
  f.sessionState.state = 'failed'; await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  await page.click('会话与环境'); await page.click('检查并恢复原工作树'); const select = document.querySelector<HTMLSelectElement>('select[aria-label="环境资源套餐"]')!;
  await act(async () => { select.value = '01a0bf5d-8f4b-7d35-8c41-6a85b807e9b5'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  state.blocked = true; state.loseResponse = true;
  const confirm = [...document.querySelectorAll('button')].find((node) => node.textContent === '确认保留工作树重建')!;
  await act(async () => { confirm.click(); confirm.click(); }); await page.settle(); expect(sent).toHaveLength(1);
  // 确认后核对弹窗关闭，回执与重试留在卡片上，卡片写明这次用的套餐。
  await act(async () => finish()); await page.settle(); expect(page.text()).toContain('暂未收到恢复回执');
  expect(document.querySelectorAll('dialog[open]').length).toBe(0); expect(select.isConnected).toBe(false); expect(page.text()).toContain('large');
  state.blocked = false; state.loseResponse = false; await page.click('重试同一恢复请求');
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect(sent[0]?.profile).toEqual({ id: '01a0bf5d-8f4b-7d35-8c41-6a85b807e9b5', name: 'large', cpu: '2', memory: '4Gi', storage: '20Gi' });
  expect(page.text()).toContain('恢复已排队'); expect(page.text()).not.toContain('原工作树已恢复');
  expect(document.querySelector('.cm-content')).toBe(editor); expect(editor.textContent).toBe('恢复前的未保存草稿');
  expect(f.commands.some((command) => ['startAgentTerminal', 'closeTerminal', 'stopAgent'].includes(command.type))).toBe(false);
  expect(f.writes.some((write) => write.method === 'DELETE')).toBe(false);
});

// 2026-09-23 起核对与确认在弹窗里：取消只关窗，选过的套餐下次核对仍在；「清空」回到当前套餐。
test('恢复核对弹窗：取消后再核对沿用选过的套餐，清空回到当前套餐', async () => {
  const { sent } = setup(); page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  const select = () => document.querySelector<HTMLSelectElement>('dialog[open] select[aria-label="环境资源套餐"]')!;
  await page.click('检查并恢复原工作树'); expect(document.querySelector('dialog[open]')?.getAttribute('role')).toBe('alertdialog');
  await act(async () => { select().value = '01a0bf5d-8f4b-7d35-8c41-6a85b807e9b5'; select().dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('保留当前工作区'); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
  await page.click('检查并恢复原工作树'); expect(select().value).toBe('01a0bf5d-8f4b-7d35-8c41-6a85b807e9b5');
  await page.click('清空'); expect(select().value).toBe('01a0bf5d-8f4b-7c08-8245-6a7766e23a18'); expect(sent).toHaveLength(0);
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
  // 受理后整页换成进页步骤清单（环境恢复中），恢复卡留在原位写明已排队：已提交的请求与回执不因换页丢掉。
  expect(document.querySelector('[data-page-loading]')?.textContent).toContain('正在恢复开发环境'); expect(page.text()).toContain('恢复已排队');
  f.sessionState.state = 'failed'; f.sessionState.rebuild!.state = 'failed'; f.sessionState.rebuild!.message = 'CPU 不足，原卷保留';
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  // 实机 Pending 超时后已得到失败结果，不能继续告诉用户回执未知并重放永久失败的请求。
  expect(page.text()).toContain('CPU 不足，原卷保留'); expect(page.text()).not.toContain('暂未确认恢复结果');
  await page.click('重新检查恢复对象');
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="环境资源套餐"]')?.disabled).toBe(false);
  await page.click('确认保留工作树重建'); expect(sent[1]?.requestId).not.toBe(sent[0]?.requestId);
});

test('恢复完成仅在工作区工具栏显示成功，详情仍保留说明且不重复启动 CLI', async () => {
  const { f } = setup(); f.sessionState.state = 'running';
  f.sessionState.message = '原工作树已恢复；需要的 CLI 请逐个手动启动';
  f.sessionState.rebuild = { id: Bun.randomUUIDv7(), requestId: crypto.randomUUID(), taskId: TaskIdSchema.parse(activityTaskId), profile: { id: '01a0bf5d-8f4b-7c08-8245-6a7766e23a18', name: 'medium', cpu: '1', memory: '2Gi', storage: '10Gi' }, state: 'ready', createdAt: activityTime, updatedAt: activityTime, message: f.sessionState.message };
  page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  const result = [...document.querySelectorAll('span')].find((node) => node.textContent === '原工作树已恢复');
  expect(result?.closest('header')).not.toBeNull(); expect(result?.title).toContain('需要的 CLI 请逐个手动启动');
  expect(f.commands.some((command) => ['startAgentTerminal', 'closeTerminal', 'stopAgent'].includes(command.type))).toBe(false);
});


test('已确认协议不兼容的运行中环境展示保卷恢复，确认完整影响后发送原因', async () => {
  const { f, check, sent } = setup(); f.sessionState.state = 'running';
  f.sessionState.connectionIssue = { code: 'protocol_mismatch', runnerProtocol: 1, requiredProtocol: 2, message: 'Runner 协议版本 1，平台要求 2', at: activityTime };
  check.reason = 'protocol_mismatch'; page = await renderApp(`/projects/${activityProjectId}/dev-session`);
  const banner = [...document.querySelectorAll('[role="alert"]')].find((node) => !node.closest('[hidden]') && node.textContent?.includes('开发环境需要更新'));
  expect(banner?.textContent).toContain('Runner 协议版本 1，平台要求 2');
  // 整页状态卡：工作区（连同「创建开发Agent会话」）等恢复完成才出现，保卷恢复就在卡下面。
  expect([...document.querySelectorAll<HTMLButtonElement>('button')].some((button) => button.textContent === '创建开发Agent会话')).toBe(false);
  expect(page.text()).not.toContain('从远端另建工作树'); await page.click('检查并恢复原工作树');
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('终止该容器内仍运行的进程');
  await page.click('确认保留工作树重建'); expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ reason: 'protocol_mismatch', expectedVolumeUid: 'kept-pvc', expectedPodUid: 'old-pod' });
  expect(page.text()).toContain('恢复已排队');
});
