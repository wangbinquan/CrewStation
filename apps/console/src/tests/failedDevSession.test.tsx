import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { focusManager } from '@tanstack/react-query';
import { EditorView } from '@codemirror/view';
import { activityProjectId, activityTaskId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; focusManager.setFocused(undefined); });
const path = `/projects/${activityProjectId}/dev-session`;

function setup() {
  const f = editorWorkspaceFixture(); fixture = f;
  const fetch = globalThis.fetch, starts: string[] = [];
  globalThis.fetch = (async (raw, init) => {
    const url = String(raw);
    if (url.endsWith('/branches')) return Response.json({ items: [{ name: 'main', headSha: 'a'.repeat(40), isDefault: true, behindPreview: 0, behindProd: 0 }] });
    if (url.endsWith('/dev-session') && init?.method === 'POST') { starts.push(String(init.body)); return Response.json({ error: 'unavailable', message: '创建尚未成功，请保留当前输入', details: {} }, { status: 503 }); }
    return fetch(raw, init);
  }) as typeof fetch;
  return { f, starts };
}

test('失败会话在首屏显示真实对象和原因，新建需明确确认且取消不创建或释放', async () => {
  const { f, starts } = setup(); f.sessionState.state = 'failed'; f.sessionState.message = '容器运行失败：OOMKilled（退出码 137）';
  page = await renderApp(path);
  // OOM 后页面曾变成无会话；失败原因不能藏在折叠的会话菜单里。
  const notice = [...document.querySelectorAll('[role="alert"]')].find((node) => node.textContent?.includes(activityTaskId) && node.textContent.includes('OOMKilled'));
  expect(notice).toBeDefined(); expect(notice!.closest('details')).toBeNull();
  expect(page.text()).toContain('不会自动恢复原 CLI'); expect(page.text()).toContain('未推送');
  // 实机 OOM 后 WebSocket 仍可回放历史；顶栏不能因此把失败会话标成绿色已连接。
  const status = [...document.querySelectorAll('header')].find((node) => node.querySelector('h1')?.textContent === '开发会话')!.querySelector('span')!;
  expect(status.textContent).toBe('失败');
  await page.click('会话与环境'); await page.click('从远端另建工作树');
  // 2026-09-23 起另建工作树在弹窗里（不画面板标题），离开失败会话的确认叠在上面。
  expect(document.querySelector('dialog[open] h2')?.textContent).toBe('从远端另建工作树'); expect(document.querySelector('dialog[open] section') === null).toBe(true);
  await page.click('从远端分支新建');
  expect(document.querySelectorAll('dialog[open]').length).toBe(2); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('main');
  expect(page.text()).toContain('页面中的未保存输入'); expect(starts).toHaveLength(0);
  await page.click('保留当前工作区'); expect(starts).toHaveLength(0); expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(f.writes.some((write) => write.method === 'DELETE')).toBe(false);
  expect(f.commands.some((command) => ['startAgentTerminal', 'closeTerminal', 'stopAgent'].includes(command.type))).toBe(false);
});

test('运行中收到失败状态不卸载编辑器草稿，明确新建失败也保留原工作区', async () => {
  const { f, starts } = setup(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts');
  const editor = document.querySelector<HTMLElement>('.cm-content')!, view = EditorView.findFromDOM(editor)!;
  await act(async () => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'OOM 前尚未保存的内容' } }); editor.focus(); });
  f.sessionState.state = 'failed'; f.sessionState.message = '容器运行失败：OOMKilled（退出码 137）';
  await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await page.settle();
  await act(async () => { f.receive({ type: 'runnerReconnected' }); }); await page.settle();
  const status = [...document.querySelectorAll('header')].find((node) => node.querySelector('h1')?.textContent === '开发会话')!.querySelector('span')!;
  expect(status.textContent).toBe('失败');
  expect(document.querySelector('.cm-content')).toBe(editor); expect(editor.textContent).toBe('OOM 前尚未保存的内容');
  expect(document.activeElement).toBe(editor);
  await page.click('会话与环境'); await page.click('从远端另建工作树');
  await page.click('从远端分支新建'); await page.click('确认新建工作树');
  expect(starts).toHaveLength(1); expect(JSON.parse(starts[0]!)).toEqual({ branch: 'main' });
  expect(page.text()).toContain('创建尚未成功，请保留当前输入');
  expect(editor.textContent).toBe('OOM 前尚未保存的内容');
  expect(f.files.get('a.ts')).toBe('磁盘原文');
  expect(f.writes.some((write) => write.method === 'DELETE')).toBe(false);
});

test('浏览器通道保持打开时，容器断连和恢复在原工作区显示且不重新创建会话', async () => {
  const { f, starts } = setup(); page = await renderApp(path);
  const status = [...document.querySelectorAll('header')].find((node) => node.querySelector('h1')?.textContent === '开发会话')!.querySelector('span')!;
  expect(status.textContent).toBe('已连接');
  await page.click('代码'); await page.click('a.ts');
  const editor = document.querySelector<HTMLElement>('.cm-content')!, view = EditorView.findFromDOM(editor)!;
  await act(async () => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '容器断连期间保留的输入' } }); editor.focus(); });
  await act(async () => { f.receive({ type: 'runnerDisconnected' }); }); await page.settle();
  // 浏览器连接和容器连接是独立的：前者 open 不能掩盖后者已经失联。
  expect(status.textContent).toBe('开发容器未连接');
  expect(document.querySelector('.cm-content')).toBe(editor); expect(editor.textContent).toBe('容器断连期间保留的输入');
  expect(document.activeElement).toBe(editor); expect(starts).toHaveLength(0);
  await act(async () => { f.receive({ type: 'runnerReconnected' }); }); await page.settle();
  expect(status.textContent).toBe('已连接');
  expect(document.querySelector('.cm-content')).toBe(editor); expect(editor.textContent).toBe('容器断连期间保留的输入');
  expect(starts).toHaveLength(0); expect(f.writes.some((write) => write.method === 'DELETE')).toBe(false);
  await act(async () => { f.receive({ type: 'event', seq: 1, event: { kind: 'runnerState', state: 'draining' } }); }); await page.settle();
  expect(status.textContent).toBe('正在收尾');
  await act(async () => { f.receive({ type: 'event', seq: 2, event: { kind: 'runnerState', state: 'shutting-down' } }); }); await page.settle();
  expect(status.textContent).toBe('正在关闭');
  await act(async () => { f.receive({ type: 'runnerReconnected' }); }); await page.settle();
  expect(status.textContent).toBe('已连接'); expect(editor.textContent).toBe('容器断连期间保留的输入');
});
