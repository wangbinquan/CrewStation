import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import type { DevSessionDto } from '@crewstation/contracts';
import { sessionConnection } from '../features/dev-session/model/connection/sessionConnection';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import { activityProjectId, activityTaskId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, f: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); f?.restore(); f = undefined; });
const path = `/projects/${activityProjectId}/dev-session`;

test('六个功能页签与个人工作区分层，往返保留代码和数据申请草稿，地址可刷新直达', async () => {
  f = editorWorkspaceFixture(); page = await renderApp(`${path}?view=code&file=a.ts`);
  const tabs = document.querySelector('[role="tablist"][aria-label="开发会话功能"]')!;
  expect([...tabs.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual(['CLI 工作区', '预览', '代码', '变更', '数据访问', '会话与环境']);
  const editor = document.querySelector<HTMLElement>('.cm-content')!, view = EditorView.findFromDOM(editor)!;
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '跨功能页保留的代码' } }));
  await page.click('数据访问'); expect(page.search().view).toBe('data');
  const reason = [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].find((node) => !node.closest('[hidden]'))!;
  await act(async () => { reason.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '排查订单问题的申请草稿'); reason.dispatchEvent(new Event('input', { bubbles: true })); reason.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page.click('会话与环境'); expect(page.search().view).toBe('session'); expect(reason.closest('[hidden]')).not.toBeNull();
  expect(document.querySelectorAll('header details[name="development-session-panels"]')).toHaveLength(0);
  await page.click('代码'); expect(document.querySelector('.cm-content')).toBe(editor); expect(editor.textContent).toBe('跨功能页保留的代码');
  await page.click('数据访问'); expect(reason.value).toBe('排查订单问题的申请草稿'); expect(reason.closest('[hidden]')).toBeNull();
  expect(f.writes.every((write) => write.path.endsWith('/workspace-layout'))).toBe(true);
  expect(f.commands.some((command) => ['writeFile', 'startAgentTerminal', 'stopAgentTerminal'].includes(command.type))).toBe(false);
  page.unmount(); page = await renderApp(`${path}?view=session`); expect(page.search().view).toBe('session');
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('会话与环境');
});

test('普通环境失联给出检查与日志，不获得重建入口；页面重连保持编辑草稿且不重复发送写入', async () => {
  f = editorWorkspaceFixture(); f.sessionState.message = '环境已连接'; page = await renderApp(`${path}?view=code&file=a.ts`);
  const editor = document.querySelector<HTMLElement>('.cm-content')!, view = EditorView.findFromDOM(editor)!;
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '离线草稿' } }));
  await act(async () => f!.receive({ type: 'runnerDisconnected' })); await page.settle();
  expect(page.text()).toContain('页面已连接，但环境尚未响应');
  // 实机 session 服务更新后，旧成功回执不能混入新的环境失联提示。
  expect(document.querySelector('[role="alert"]')?.textContent).not.toContain('环境已连接');
  await page.click('检查状态'); await page.click('查看会话与环境'); expect(page.search().view).toBe('session');
  expect(page.text()).not.toContain('检查并恢复原工作树');
  expect(f.writes.every((write) => write.path.endsWith('/workspace-layout'))).toBe(true);
  expect(editor.textContent).toBe('离线草稿'); expect(f.openStreams(activityTaskId)).toBe(1);
});

test('连接引导区分页面、容器、准备、协议和恢复状态，回放连接不覆盖真实失败', () => {
  const session = { state: 'running' } as DevSessionDto, open = { ...INITIAL_STREAM_STATE, status: 'open' as const, runnerConnected: true };
  expect(sessionConnection(session, open)).toBe('ready');
  expect(sessionConnection(session, INITIAL_STREAM_STATE)).toBe('browser');
  expect(sessionConnection(session, { ...open, runnerConnected: false })).toBe('unknown');
  expect(sessionConnection({ ...session, state: 'creating' }, open)).toBe('starting');
  expect(sessionConnection({ ...session, state: 'failed' }, open)).toBe('failed');
  expect(sessionConnection({ ...session, connectionIssue: { code: 'protocol_mismatch', runnerProtocol: 1, requiredProtocol: 2, message: 'rejected', at: '2026-09-20T00:00:00Z' } }, open)).toBe('protocol');
  expect(sessionConnection({ ...session, state: 'releasing' }, open)).toBe('releasing');
  expect(sessionConnection(session, { ...open, runnerState: 'draining' })).toBe('stopping');
});

test.each([false, true])('档位读取失败有刷新及匹配身份的配置指引（管理员=%s）', async (isAdmin) => {
  f = editorWorkspaceFixture(); const base = globalThis.fetch; let available = false;
  globalThis.fetch = (async (raw, init) => {
    if (String(raw).endsWith('/compute-profiles')) return available
      ? Response.json({ items: [{ name: 'ready', available: true, isDefault: true, terminalOnly: false, description: '' }] })
      : Response.json({ error: 'unavailable', message: '算力目录暂不可读' }, { status: 503 });
    const response = await base(raw, init);
    return String(raw).endsWith('/v1/me') ? Response.json({ ...await response.json(), isAdmin }) : response;
  }) as typeof fetch;
  page = await renderApp(`${path}?view=cli`);
  expect(page.text()).toContain('算力目录暂不可读');
  expect(Boolean(document.querySelector('a[href="/admin/compute"]'))).toBe(isAdmin);
  if (!isAdmin) expect(page.text()).toContain('请联系管理员提供可用档位');
  const create = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '＋ 创建开发Agent会话')!;
  expect(create().disabled).toBe(true);
  available = true; await page.click('刷新档位');
  expect(create().disabled).toBe(false);
  expect(f.writes.every((write) => write.path.endsWith('/workspace-layout'))).toBe(true);
});
