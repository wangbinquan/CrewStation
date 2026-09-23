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

/** 新开 CLI 的唯一入口（2026-09-23 起在页头，原工具行去掉）：拆分按钮主键直接创建、展开换档位与权限；这里只替代 HTTP 边界。 */
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

test('没有 CLI 与有 CLI 时，CLI 区都只有标签：没有工作区页签、布局菜单与工作区设置，展开的只有新开按钮的箭头', async () => {
  setup(); page = await renderElement(element(), messages);
  expect(summaries().map((node) => node.getAttribute('aria-label'))).toEqual(['选择档位与权限']);
  page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
  const terminal = activityFixture().terminal, layout = initialWorkspaceLayout('工作区 1'); layout.tabs[0]!.paneOrder = [terminal.terminalId];
  setup({ layout, roster: [terminal] }); page = await renderElement(element(), messages);
  expect(summaries().map((node) => node.getAttribute('aria-label'))).toEqual(['选择档位与权限']);
  expect(page.host.querySelector(`[data-dock-tab="${terminal.terminalId}"]`)).not.toBeNull();
  for (const gone of ['＋ 工作区', '布局 ▾', '工作区设置', '收起窗口', '向前排列']) expect(page.text()).not.toContain(gone);
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
