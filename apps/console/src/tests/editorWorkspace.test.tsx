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
async function save() {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === '保存')!;
  await act(async () => button.click()); await page!.settle();
}

test('真实工作台的 CodeMirror 草稿跨预览／CLI 保留；离开确认不停止任何 CLI', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts'); expect(content().textContent).toBe('磁盘原文');
  // 代码直接铺进页签：不再内嵌一张带「代码」标题的卡片；树节点带选中文件的完整路径提示。
  const editorPane = document.querySelector('nav[aria-label="工作目录文件"]')!.closest('section')!;
  expect(editorPane.querySelector('h2')).toBeNull(); expect(editorPane.textContent).not.toContain('编辑器');
  expect([...document.querySelectorAll<HTMLButtonElement>('nav button')].find((node) => node.textContent === 'a.ts')?.title).toMatch(/a\.ts$/);
  await edit('正在编写的函数'); expect(page.text()).toContain('代码 · 未保存');
  await page.click('预览'); expect(page.text()).toContain('编辑器有未保存输入');
  await page.click('收起'); expect(document.querySelector('[role="region"][aria-label="CLI 区"]')?.closest('[hidden]')).toBeNull();
  await page.click('代码 · 未保存'); expect(content().textContent).toBe('正在编写的函数');
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
  expect(button('关闭').disabled).toBe(true); expect(button('b.ts').disabled).toBe(true);
  await page.click('会话与环境'); await page.click('释放会话'); expect(page.text()).toContain('本页面编辑器「a.ts」有未保存输入'); expect(page.text()).toContain('未包含在下方 Git 清单中');
  expect(button('确认释放').disabled).toBe(true); expect(page.text()).toContain('编辑器正在读写文件');
  await act(async () => fixture!.finishWrite()); await page.settle();
  expect(button('确认释放').disabled).toBe(false); expect(page.text()).not.toContain('本页面编辑器「a.ts」有未保存输入');
  await page.click('取消'); expect(fixture.writes.some((write) => write.method === 'DELETE')).toBe(false);
  await page.click('代码'); await page.click('b.ts'); expect(content().textContent).toBe('第二个文件'); expect(page.text()).not.toContain('放弃输入并继续');
  expect(fixture.commands.filter((command) => command.type === 'writeFile')).toHaveLength(1);
});

test('代码视图隐藏后返回仍确认草稿，取消后恢复原内容；确认才回到上一页面', async () => {
  fixture = editorWorkspaceFixture();
  const history = browserHistoryFixture([`/projects/${activityProjectId}`, path]);
  page = await renderApp(path, undefined, history.history);
  await page.click('代码'); await page.click('a.ts'); await edit('返回前的草稿'); await page.click('预览');
  await page.back(); expect(page.search().view).toBe('code'); expect(content().textContent).toBe('返回前的草稿');
  await page.back(); await page.back(); expect(page.path()).toBe(path); expect(page.text()).not.toContain('放弃输入并离开');
  await page.back(); expect(page.path()).toBe(path); expect(page.text()).toContain('编辑器「a.ts」有未保存的输入');
  await page.click('继续编辑'); expect(content().textContent).toBe('返回前的草稿');
  await page.back(); await page.click('放弃输入并离开'); expect(page.path()).toBe(`/projects/${activityProjectId}`);
  expect(fixture.commands.some((command) => ['writeFile', 'closeTerminal', 'stopAgent'].includes(command.type))).toBe(false);
});

test('收起数据访问仍保护申请输入，与编辑器草稿合并一次确认；释放前也明确提示', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('数据访问');
  const reason = [...document.querySelectorAll('label')].find((node) => node.textContent?.startsWith('申请理由'))!.querySelector('textarea')!;
  await act(async () => { reason.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, '排错草稿'); reason.dispatchEvent(new Event('input', { bubbles: true })); reason.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page.settle(); expect(page.text()).toContain('数据访问 · 未保存');
  await page.click('代码'); await page.click('a.ts'); await edit('代码草稿');
  await page.requestNavigate(`/projects/${activityProjectId}/release`); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1); expect(page.text()).toContain('编辑器「a.ts」 / 数据访问有未保存的输入');
  await page.click('继续编辑'); expect(reason.value).toBe('排错草稿'); expect(content().textContent).toBe('代码草稿');
  await page.click('会话与环境'); await page.click('释放会话'); expect(page.text()).toContain('数据访问有未提交的申请或审批输入'); await page.click('取消');
  expect(fixture.writes.some((write) => write.method === 'DELETE')).toBe(false);
});

test('开发页唯一准备发布入口带会话来源，确认草稿后跳转不推送、不停止 CLI', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  expect(page.text()).not.toContain('发布到待命槽'); await page.click('代码'); await page.click('a.ts'); await edit('仅编辑器中的草稿');
  await page.click('准备发布'); expect(page.path()).toBe(path); await page.click('继续编辑'); expect(content().textContent).toBe('仅编辑器中的草稿');
  await page.click('准备发布'); await page.click('放弃输入并离开'); expect(page.search().source).toBe('session'); expect(page.path()).toBe(`/projects/${activityProjectId}/release`);
  await page.click('检查发布来源'); expect(page.text()).toContain('确认版本');
  expect(fixture.commands.some((command) => ['writeFile', 'closeTerminal', 'stopAgent', 'stopNativeTerminal'].includes(command.type))).toBe(false);
  expect(fixture.writes.every((write) => write.path.endsWith('/workspace-layout'))).toBe(true);
});

test('保存冲突在代码区之前提示并聚焦继续编辑，后续输入不再被抢焦点', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts'); await edit('我的未保存草稿');
  fixture.files.set('a.ts', 'Agent 新内容');
  await save();
  await act(async () => fixture!.finishWrite({ code: 'version_conflict', message: '磁盘版本已变更' })); await page.settle();
  const warning = [...document.querySelectorAll('[role="alert"]')].find((node) => node.textContent?.includes('磁盘上的文件已经变了'))!;
  expect(warning).toBeDefined();
  // 实机并发保存冲突曾藏在整屏代码下方，且没有把焦点交给保留草稿的恢复动作。
  expect(Boolean(warning.compareDocumentPosition(content()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(document.activeElement?.textContent).toBe('继续编辑');
  expect(content().textContent).toBe('我的未保存草稿'); expect(fixture.files.get('a.ts')).toBe('Agent 新内容');
  await act(async () => content().focus()); await edit('冲突后继续输入');
  expect(document.activeElement).toBe(content());
  await page.click('继续编辑'); expect(content().textContent).toBe('冲突后继续输入');
  expect(fixture.commands.filter((command) => command.type === 'writeFile')).toHaveLength(1);
});

test('保存失败的真实原因在代码区之前获得焦点，不自动重发或清掉草稿', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts'); await edit('断线前的草稿'); await save();
  await act(async () => fixture!.finishWrite({ code: 'disconnected', message: '保存回执未取得，请重新连接' })); await page.settle();
  const warning = [...document.querySelectorAll('[role="alert"]')].find((node) => node.textContent?.includes('保存回执未取得'))!;
  // 保存失败必须在当前代码区可见，不能只留下页尾错误或静默重复写入。
  expect(Boolean(warning.compareDocumentPosition(content()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(document.activeElement?.contains(warning)).toBe(true);
  expect(content().textContent).toBe('断线前的草稿'); expect(fixture.files.get('a.ts')).toBe('磁盘原文');
  expect(fixture.commands.filter((command) => command.type === 'writeFile')).toHaveLength(1);
});

test('冲突后重新载入失败仍显示读取错误和原草稿，放弃确认位于代码区之前', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts'); await edit('需要保留的草稿'); await save();
  await act(async () => fixture!.finishWrite({ code: 'version_conflict', message: 'Agent 已修改' })); await page.settle();
  await page.click('重新载入');
  const confirmation = document.querySelector('[role="alertdialog"]')!;
  expect(Boolean(confirmation.compareDocumentPosition(content()) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(document.activeElement?.textContent).toBe('继续编辑');
  fixture.files.delete('a.ts'); await page.click('放弃输入并继续');
  // 冲突标记仍存在时，过去的提前返回会吞掉重新载入失败的真实原因。
  expect(page.text()).toContain('文件不存在：a.ts'); expect(page.text()).toContain('磁盘上的文件已经变了');
  expect(content().textContent).toBe('需要保留的草稿');
  expect(document.activeElement?.textContent).toContain('文件不存在：a.ts');
});


test('断连明确说明文件不可读取，保留编辑草稿并禁用保存，重连后恢复', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(path);
  await page.click('代码'); await page.click('a.ts'); await edit('离线草稿');
  await act(async () => fixture!.receive({ type: 'streamReady', connected: false, replayed: 0 })); await page.settle();
  expect(page.text()).toContain('开发环境未连接，文件列表暂不可读');
  expect(content().textContent).toBe('离线草稿');
  const save = [...document.querySelectorAll('button')].find((button) => button.textContent === '保存')!;
  expect(save.disabled).toBe(true);
  await act(async () => fixture!.receive({ type: 'streamReady', connected: true, replayed: 0 })); await page.settle();
  expect(page.text()).not.toContain('文件列表暂不可读'); expect(save.disabled).toBe(false);
  expect(content().textContent).toBe('离线草稿');
});
