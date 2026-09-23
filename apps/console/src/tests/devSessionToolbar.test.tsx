import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { NativeTerminalDto, WorkspaceLayout } from '@crewstation/contracts';
import { NativeWorkspace } from '../features/dev-session/components/native/NativeWorkspace';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';
import { activityFixture } from './agentActivityFixture';
import { renderElement } from './renderElement';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(async () => { page?.unmount(); await new Promise((resolve) => setTimeout(resolve, 0)); page = undefined; globalThis.fetch = originalFetch; });

/** 一条工具行（RFC-020 §4.3）：拆分按钮、布局菜单、工作区设置菜单；这里只替代 HTTP 边界。 */
function setup(options: { readonly layout?: WorkspaceLayout; readonly roster?: NativeTerminalDto[]; readonly profiles?: Record<string, unknown>[] } = {}) {
  const starts: Record<string, unknown>[] = [];
  globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = String(raw), method = init?.method ?? 'GET';
    let body: unknown = {}, status = 200;
    if (url.endsWith('/workspace-layout')) {
      if (method === 'PUT') { const input = JSON.parse(String(init?.body)); body = { layout: input.layout, revision: input.expectedRevision + 1, updatedAt: '2026-09-13T00:00:00.000Z' }; }
      else body = options.layout ? { revision: 1, layout: options.layout, updatedAt: '2026-09-13T00:00:00.000Z' } : { revision: 0, layout: null, updatedAt: null };
    } else if (url.endsWith('/agent-terminals')) {
      if (method === 'POST') { starts.push(JSON.parse(String(init?.body))); status = 412; body = { error: 'precondition', message: '演示拒绝', details: {} }; }
      else body = { items: options.roster ?? [], connection: 'connected', runnerId: options.roster?.[0]?.runnerId ?? null, checkedAt: '2026-09-13T00:00:00.000Z', activitySync: 'ready' };
    } else body = { items: options.profiles ?? [{ name: 'balanced', description: '标准', terminalOnly: false, isDefault: true, available: true }] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { starts };
}
const element = (props: { readonly blockedReason?: string } = {}) => <NativeWorkspace projectId="project-1" taskId="task-1" userId="user-1" channel={{ send: async () => ({}), subscribe: () => () => {} }} stream={{ ...INITIAL_STREAM_STATE, status: 'open', runnerConnected: true, generation: 1 }} canDevelop onActivity={() => {}} preview={null} editor={null} changes={null} {...props} />;
const summaries = () => [...page!.host.querySelectorAll<HTMLElement>('summary')];

test('主键按记住的档位直接创建；展开菜单换权限后随请求发出，菜单里有档位与权限说明', async () => {
  const f = setup(); page = await renderElement(element(), messages);
  const caret = summaries().find((node) => node.getAttribute('aria-label') === '选择档位与权限')!;
  expect(caret).toBeDefined(); await act(async () => caret.click()); await page.settle();
  expect(page.text()).toContain('控制 CLI 可以执行的操作');
  const permission = page.host.querySelector<HTMLSelectElement>('select[aria-label="权限"]')!;
  const chosen = [...permission.options].find((option) => option.value !== permission.value)!.value;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(permission, chosen); permission.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  await page.click('＋ 创建开发Agent会话');
  expect(f.starts).toHaveLength(1); expect(f.starts[0]).toMatchObject({ permission: chosen }); expect(page.text()).toContain('演示拒绝');
});

test('没有窗口时没有「布局」菜单；有窗口时可换排布，工作区设置菜单可重命名并列出已启动', async () => {
  setup(); page = await renderElement(element(), messages);
  expect(summaries().map((node) => node.textContent)).not.toContain('布局 ▾');
  page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
  const terminal = activityFixture().terminal, layout = initialWorkspaceLayout('工作区 1'); layout.tabs[0]!.paneOrder = [terminal.terminalId];
  setup({ layout, roster: [terminal] }); page = await renderElement(element(), messages);
  const layoutMenu = summaries().find((node) => node.textContent === '布局 ▾')!;
  expect(layoutMenu).toBeDefined(); await act(async () => layoutMenu.click()); await page.settle();
  await page.click('纵排'); expect(page.host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('纵排');
  const settings = summaries().find((node) => node.getAttribute('aria-label') === '工作区设置')!;
  await act(async () => settings.click()); await page.settle();
  expect(page.text()).toContain('已启动 1');
  await page.click('重命名');
  const input = page.host.querySelector<HTMLInputElement>('input[aria-label="页签名称"]')!;
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '排错'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page.settle();
  await act(async () => { input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
  expect(page.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('排错 · 1');
});

const startButton = () => [...page!.host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '＋ 创建开发Agent会话')!;
const startCaret = () => page!.host.querySelector<HTMLElement>('[aria-label="选择档位与权限"]')!;

test('环境还没就绪时主键与展开箭头一起置灰，箭头点不开', async () => {
  // 2026-09-23 作者实机：判断开发环境的这段时间主键是灰的、右侧箭头却是亮的，要一起灰。
  setup(); page = await renderElement(element({ blockedReason: '正在检查开发环境' }), messages);
  expect(startButton().disabled).toBe(true);
  expect(startCaret().tagName).toBe('BUTTON'); expect((startCaret() as HTMLButtonElement).disabled).toBe(true);
  expect(page.host.querySelector('select[aria-label="权限"]')).toBeNull();
});

test('所选档位不可用时主键置灰，展开箭头仍可用：换档位要靠它', async () => {
  setup({ profiles: [{ name: 'balanced', description: '标准', terminalOnly: false, isDefault: true, available: false }] });
  page = await renderElement(element(), messages);
  expect(startButton().disabled).toBe(true); expect(startCaret().tagName).toBe('SUMMARY');
  await act(async () => startCaret().click()); await page.settle();
  expect(startCaret().closest('details')!.open).toBe(true);
});
