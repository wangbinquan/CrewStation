import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { activityFixture, activityProjectId, activityTaskId } from './agentActivityFixture';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';
import { parseDevelopmentSearch } from '../shared/project/developmentSearch';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { browserHistoryFixture } from './browserHistoryFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined; });
const path = `/projects/${activityProjectId}/dev-session`;
const content = () => document.querySelector<HTMLElement>('.cm-content');
/** 工具面板当前页签（CLI 标签栏在前，不能用第一个 aria-selected）。 */
const panelTab = () => document.querySelector('[aria-label="工具面板"] [role="tab"][aria-selected="true"]')?.textContent;
async function edit(text: string) { const view = EditorView.findFromDOM(content()!)!;
  await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })); await page!.settle(); }

test('文件链接进入真实代码视图，切换视图更新地址，返回不会重复读取或启动 CLI', async () => {
  fixture = editorWorkspaceFixture(); const url = `${path}?view=code&file=b.ts`, history = browserHistoryFixture([url]);
  page = await renderApp(url, undefined, history.history); expect(content()?.textContent).toBe('第二个文件');
  expect(page.search().file).toBe('b.ts'); await page.click('预览'); expect(page.search().view).toBe('preview'); expect(content()?.closest('[hidden]')).not.toBeNull();
  await page.back(); expect(page.search().view).toBe('code'); expect(content()?.textContent).toBe('第二个文件');
  expect(fixture.commands.filter((c) => c.type === 'readFile')).toHaveLength(1);
  expect(fixture.writes.every((w) => w.path.endsWith('/workspace-layout'))).toBe(true);
});

test('文件链接切换先保护旧草稿，取消保留地址与输入，确认后只读取目标文件', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(`${path}?view=code&file=a.ts`); await edit('未保存的 A');
  await page.requestNavigate(`${path}?view=code&file=b.ts`); expect(page.search().file).toBe('a.ts'); expect(page.text()).toContain('放弃「a.ts」的未保存输入并打开「b.ts」');
  await page.click('继续编辑'); expect(content()?.textContent).toBe('未保存的 A');
  expect(fixture.commands.some((c) => c.type === 'readFile' && c.path === 'b.ts')).toBe(false);
  await page.requestNavigate(`${path}?view=code&file=b.ts`); await page.click('放弃并打开「b.ts」');
  expect(page.search().file).toBe('b.ts'); expect(content()?.textContent).toBe('第二个文件'); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
  expect(fixture.commands.filter((c) => c.type === 'writeFile')).toHaveLength(0);
});

test('关闭文件清除当前文件地址，取消关闭和读入失败均保留旧草稿', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(`${path}?view=code&file=a.ts`); await edit('不能丢失');
  await page.click('关闭'); await page.click('继续编辑'); expect(page.search().file).toBe('a.ts'); expect(content()?.textContent).toBe('不能丢失');
  await page.requestNavigate(`${path}?view=code&file=missing.ts`); await page.click('放弃并打开「missing.ts」');
  expect(content()?.textContent).toBe('不能丢失'); expect(page.text()).toContain('未保存');
  await page.click('关闭'); await page.click('放弃输入并继续');
  expect(page.search().file).toBeUndefined(); expect(Boolean(content())).toBe(false);
  await page.click('a.ts'); expect(content()?.textContent).toBe('磁盘原文');
  expect(fixture.commands.filter((c) => c.type === 'writeFile')).toHaveLength(0);
});

test('保存回执到达前不能确认文件跳转，保存期间的新输入仍需明确放弃', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(`${path}?view=code&file=a.ts`); await edit('发出的保存');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === '保存')!.click()); await page.settle();
  await page.requestNavigate(`${path}?view=code&file=b.ts`);
  const confirm = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '放弃并打开「b.ts」')!;
  expect(confirm().disabled).toBe(true); await page.click('继续编辑'); expect(page.search().file).toBe('a.ts');
  await page.requestNavigate(`${path}?view=code&file=b.ts`); await edit('保存期间的新输入'); await act(async () => fixture!.finishWrite()); await page.settle();
  expect(confirm().disabled).toBe(false); expect(content()?.textContent).toBe('保存期间的新输入'); expect(fixture.files.get('a.ts')).toBe('发出的保存');
  await page.click('继续编辑'); expect(page.search().file).toBe('a.ts');
  await page.requestNavigate(`${path}?view=code&file=b.ts`); await page.click('放弃并打开「b.ts」'); expect(content()?.textContent).toBe('第二个文件');
});

test('中文路径完整传入读取，非法视图／控制字符参数不会进入工作区状态', async () => {
  fixture = editorWorkspaceFixture(); const file = 'src/中文 参数.ts'; fixture.files.set(file, '含空格的路径');
  page = await renderApp(`${path}?file=${encodeURIComponent(file)}`); expect(content()?.textContent).toBe('含空格的路径'); expect(fixture.commands.some((c) => c.type === 'readFile' && c.path === file)).toBe(true);
  expect(parseDevelopmentSearch({ view: ['cli'], file: 'a\n.ts', target: 'invalid' })).toEqual({});
  await page.navigate(`${path}?target=preview`); expect(panelTab()).toContain('变更');
});

test('差异别名与待验证目标接到实际查询，空 CLI 工作区也能打开并排预览', async () => {
  fixture = editorWorkspaceFixture(); const base = globalThis.fetch, calls: URL[] = [];
  globalThis.fetch = (async (raw, init) => { calls.push(new URL(String(raw), 'http://localhost')); return base(raw, init); }) as typeof fetch;
  page = await renderApp(`${path}?view=changes&target=preview`);
  expect(panelTab()).toContain('变更');
  expect(calls.some((url) => url.pathname.endsWith('/version-comparison') && url.searchParams.get('target') === 'preview')).toBe(true);
  expect(page.text()).toContain('工作树与待验证版本'); await page.navigate(`${path}?view=split`);
  expect(page.text()).toContain('开发预览'); expect(page.text()).toContain('创建第一个开发Agent会话');
  // RFC-020：工具在右侧面板里，「收起」回到纯终端（view=cli）；还没有 CLI 时 CLI 区中间是创建入口。
  await page.click('代码'); expect(page.search().view).toBe('code'); await page.click('收起'); expect(page.search().view).toBe('cli');
  expect(document.querySelector('[role="region"][aria-label="CLI 区"]')?.textContent).toContain('创建第一个开发Agent会话');
  expect(fixture.commands.some((c) => c.type === 'startAgentTerminal' || c.type === 'stopAgentTerminal')).toBe(false);
});

test('链接指定旧会话时不读新会话文件，不定位错误 CLI；选择当前视图后可继续', async () => {
  fixture = editorWorkspaceFixture(); page = await renderApp(`${path}?view=code&file=b.ts&task=01a0bf5d-8f4b-70bf-8bc6-de281b863440`);
  expect(page.text()).toContain('链接指定的开发会话或 CLI 已变化'); expect(fixture.commands.filter((c) => c.type === 'readFile')).toHaveLength(0);
  await page.click('代码'); expect(content()?.textContent).toBe('第二个文件'); expect(page.search().task).toBeUndefined();
  await page.navigate(`${path}?agent=missing-agent`); expect(page.text()).toContain('未定位到其他会话'); expect(page.text()).not.toContain('CLI missing');
  expect(fixture.writes.every((w) => w.path.endsWith('/workspace-layout'))).toBe(true);
});

test('普通 Agent 链接恢复已存在窗口并覆盖个人视图，不标记已读或取得控制', async () => {
  fixture = editorWorkspaceFixture(); const f = activityFixture(), base = globalThis.fetch;
  // 旧布局里被「收起」的在运行 CLI：标签组没有收起状态，它回到标签里；链接再把它设为当前标签。
  const layout = { ...initialWorkspaceLayout('已有页签'), view: 'preview' as const, hiddenTerminalIds: [f.terminal.terminalId] };
  globalThis.fetch = (async (raw, init) => {
    const pathname = new URL(String(raw), 'http://localhost').pathname;
    if (pathname.endsWith('/agent-terminals') && (init?.method ?? 'GET') === 'GET') return Response.json(f.roster);
    if (pathname.endsWith('/workspace-layout') && (init?.method ?? 'GET') === 'GET') return Response.json({ revision: 1, layout, updatedAt: f.terminal.startedAt });
    return base(raw, init);
  }) as typeof fetch;
  page = await renderApp(`${path}?agent=${f.terminal.agentId}&terminal=${f.terminal.terminalId}&task=${activityTaskId}`);
  expect(document.querySelectorAll(`[data-native-terminal="${f.terminal.terminalId}"]`)).toHaveLength(1);
  const selected = () => document.querySelector('[role="tablist"][aria-label="标签组"] [role="tab"][aria-selected="true"]')?.textContent ?? '';
  expect(selected()).toContain(`CLI ${f.terminal.agentId.slice(-6)}`);
  await page.click('代码'); await page.click('收起'); expect(page.search().view).toBe('cli');
  expect(selected()).toContain(`CLI ${f.terminal.agentId.slice(-6)}`); expect(document.querySelectorAll(`[data-native-terminal="${f.terminal.terminalId}"]`)).toHaveLength(1);
  expect(fixture.writes.every((w) => w.path.endsWith('/workspace-layout'))).toBe(true);
  expect(fixture.commands.some((c) => ['startAgentTerminal', 'stopAgentTerminal', 'claimTerminalControl', 'terminalInput'].includes(c.type))).toBe(false);
});

test('发布预检的未提交文件链接携带原会话，进入代码只读取目标文件', async () => {
  fixture = editorWorkspaceFixture(); const base = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => {
    const response = await base(raw, init);
    if (String(raw).endsWith('/workspace-status')) return Response.json({ ...await response.json(), uncommittedCount: 1, uncommitted: [{ path: 'b.ts', status: '.M', index: '.', worktree: 'M' }] });
    return response;
  }) as typeof fetch;
  page = await renderApp(`/projects/${activityProjectId}/release?source=session`); await page.click('b.ts');
  expect(page.path()).toBe(path); expect(page.search()).toMatchObject({ view: 'code', file: 'b.ts', task: activityTaskId }); expect(content()?.textContent).toBe('第二个文件');
  expect(fixture.commands.filter((c) => c.type === 'readFile')).toHaveLength(1);
  expect(fixture.writes.every((w) => w.path.endsWith('/workspace-layout'))).toBe(true);
  await page.click('会话与环境'); await page.click('释放会话');
  const listed = document.querySelector<HTMLButtonElement>('[role="alertdialog"] button'); expect(listed?.textContent).toBe('b.ts');
  await act(async () => listed!.click()); await page.settle(); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(0);
  expect(content()?.textContent).toBe('第二个文件'); expect(fixture.writes.some((w) => w.method === 'DELETE')).toBe(false);
});
