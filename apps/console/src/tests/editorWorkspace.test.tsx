import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { activityProjectId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';
import { browserHistoryFixture } from './browserHistoryFixture';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; });
const path = `/projects/${activityProjectId}/dev-session`;
const content = () => document.querySelector<HTMLElement>('.cm-content')!;
async function edit(text: string) {
  const view = EditorView.findFromDOM(content())!;
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }));
  await page!.settle();
}

test('真实工作台的 CodeMirror 草稿跨预览／CLI 保留；离开确认不停止任何 CLI', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts'); expect(content().textContent).toBe('磁盘原文');
  await edit('正在编写的函数'); expect(page.text()).toContain('代码 · 未保存');
  await page.click('预览'); expect(page.text()).toContain('编辑器有未保存输入');
  await page.click('工作区 1'); await page.click('代码 · 未保存'); expect(content().textContent).toBe('正在编写的函数');
  await page.requestNavigate(`${path}?view=code`); expect(page.text()).not.toContain('放弃输入并离开');
  await page.requestNavigate(`${path}?view=conversation`); expect(page.path()).toBe(path); expect(page.text()).toContain('放弃输入并离开'); await page.click('继续编辑');
  await page.requestNavigate(`/projects/${activityProjectId}/release`);
  expect(page.path()).toBe(path); expect(page.text()).toContain('编辑器「a.ts」有未保存的输入');
  await page.click('继续编辑'); expect(content().textContent).toBe('正在编写的函数');
  await page.requestNavigate(`/projects/${activityProjectId}/release`); await page.click('放弃输入并离开');
  expect(page.path()).toBe(`/projects/${activityProjectId}/release`);
  expect(fixture.commands.some((command) => ['writeFile', 'closeTerminal', 'stopAgent', 'stopNativeTerminal'].includes(command.type))).toBe(false);
  expect(fixture.writes.every((write) => write.path.endsWith('/workspace-layout'))).toBe(true);
});

test('文件树换文件和工具栏关闭均明确放弃；在途保存锁住换文件与释放确认', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts'); await edit('尚未写入');
  await page.click('b.ts'); expect(page.text()).toContain('放弃并打开「b.ts」');
  await page.click('继续编辑'); expect(content().textContent).toBe('尚未写入');
  await page.click('关闭'); expect(page.text()).toContain('关闭编辑器'); await page.click('继续编辑');
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === text)!;
  await act(async () => button('保存').click()); await page.settle();
  expect(button('关闭').disabled).toBe(true); expect(button('·b.ts').disabled).toBe(true);
  await page.click('释放会话'); expect(page.text()).toContain('本页面编辑器「a.ts」有未保存输入'); expect(page.text()).toContain('未包含在下方 Git 清单中');
  expect(button('确认释放').disabled).toBe(true); expect(page.text()).toContain('编辑器正在读写文件');
  await act(async () => fixture!.finishWrite()); await page.settle();
  expect(button('确认释放').disabled).toBe(false); expect(page.text()).not.toContain('本页面编辑器「a.ts」有未保存输入');
  await page.click('取消'); expect(fixture.writes.some((write) => write.method === 'DELETE')).toBe(false);
  await page.click('b.ts'); expect(content().textContent).toBe('第二个文件'); expect(page.text()).not.toContain('放弃输入并继续');
  expect(fixture.commands.filter((command) => command.type === 'writeFile')).toHaveLength(1);
});

test('代码视图隐藏后返回仍确认草稿，取消后恢复原内容；确认才回到上一页面', async () => {
  fixture = editorWorkspaceFixture();
  const history = browserHistoryFixture([`/projects/${activityProjectId}/settings?tab=repository`, path]);
  page = await renderApp(path, undefined, history.history);
  await page.click('代码'); await page.click('a.ts'); await edit('返回前的草稿'); await page.click('预览');
  await page.back(); expect(page.path()).toBe(path); expect(page.text()).toContain('编辑器「a.ts」有未保存的输入');
  await page.click('继续编辑'); await page.click('代码 · 未保存'); expect(content().textContent).toBe('返回前的草稿');
  await page.back(); await page.click('放弃输入并离开'); expect(page.path()).toBe(`/projects/${activityProjectId}/settings`);
  expect(fixture.commands.some((command) => ['writeFile', 'closeTerminal', 'stopAgent'].includes(command.type))).toBe(false);
});
