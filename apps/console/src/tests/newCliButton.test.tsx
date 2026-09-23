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
const balanced = '01a0bf5d-8f4b-7111-8111-111111111111';
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(async () => { page?.unmount(); await new Promise((resolve) => setTimeout(resolve, 0)); page = undefined; globalThis.fetch = originalFetch; });

/** 新开 CLI 的唯一入口（2026-09-23 起在页头，原工具行去掉）：拆分按钮主键直接创建、展开换档位；这里只替代 HTTP 边界。 */
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
    } else body = { items: options.profiles ?? [{ id: balanced, name: 'balanced', description: '标准', terminalOnly: false, isDefault: true, available: true }] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { starts };
}
const element = (props: { readonly blockedReason?: string } = {}) => <NativeWorkspace projectId="project-1" taskId="task-1" userId="user-1" channel={{ send: async () => ({}), subscribe: () => () => {} }} stream={{ ...INITIAL_STREAM_STATE, status: 'open', runnerConnected: true, generation: 1 }} canDevelop onActivity={() => {}} preview={null} editor={null} changes={null} {...props} />;
const summaries = () => [...page!.host.querySelectorAll<HTMLElement>('summary')];

test('主键按记住的档位直接创建；展开菜单只换档位，没有权限可选，请求里也不带权限（D59）', async () => {
  const f = setup(); page = await renderElement(element(), messages);
  // 2026-09-23 作者裁定拆成两个按钮：主按钮「创建开发Agent会话」＋描边按钮「选择算力档位」，没有 ＋ 与 ▾。
  const caret = summaries().find((node) => node.textContent === '选择算力档位')!;
  expect(caret).toBeDefined(); await act(async () => caret.click()); await page.settle();
  const menu = caret.closest('details')!;
  expect(menu.querySelectorAll('select')).toHaveLength(1); expect(menu.querySelector('select[aria-label="算力档位"]')).not.toBeNull();
  for (const gone of ['权限', '只读', '可改文件', '完全权限', '控制 CLI 可以执行的操作']) expect(menu.textContent).not.toContain(gone);
  await page.click('创建开发Agent会话');
  expect(f.starts).toHaveLength(1); expect(f.starts[0]).not.toHaveProperty('permission'); expect(page.text()).toContain('演示拒绝');
});

test('没有 CLI 与有 CLI 时，CLI 区都只有标签：没有工作区页签、布局菜单与工作区设置，能展开的只有「选择算力档位」', async () => {
  setup(); page = await renderElement(element(), messages);
  expect(summaries().map((node) => node.textContent)).toEqual(['选择算力档位']);
  page.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
  const terminal = activityFixture().terminal, layout = initialWorkspaceLayout('工作区 1'); layout.tabs[0]!.paneOrder = [terminal.terminalId];
  setup({ layout, roster: [terminal] }); page = await renderElement(element(), messages);
  expect(summaries().map((node) => node.textContent)).toEqual(['选择算力档位']);
  expect(page.host.querySelector(`[data-dock-tab="${terminal.terminalId}"]`)).not.toBeNull();
  for (const gone of ['＋ 工作区', '布局 ▾', '工作区设置', '收起窗口', '向前排列']) expect(page.text()).not.toContain(gone);
});

const startButton = () => [...page!.host.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === '创建开发Agent会话')!;
const startCaret = () => [...page!.host.querySelectorAll<HTMLElement>('button, summary')].find((node) => node.textContent === '选择算力档位')!;

test('环境还没就绪时两个按钮一起置灰，「选择算力档位」点不开', async () => {
  // 2026-09-23 作者实机：判断开发环境的这段时间主键是灰的、右侧箭头却是亮的，要一起灰（拆成两个按钮后照旧）。
  setup(); page = await renderElement(element({ blockedReason: '正在检查开发环境' }), messages);
  expect(startButton().disabled).toBe(true);
  expect(startCaret().tagName).toBe('BUTTON'); expect((startCaret() as HTMLButtonElement).disabled).toBe(true);
  expect(page.host.querySelector('select[aria-label="算力档位"]')).toBeNull();
});

test('所选档位不可用时主按钮置灰，「选择算力档位」仍可用：换档位要靠它', async () => {
  setup({ profiles: [{ id: balanced, name: 'balanced', description: '标准', terminalOnly: false, isDefault: true, available: false }] });
  page = await renderElement(element(), messages);
  expect(startButton().disabled).toBe(true); expect(startCaret().tagName).toBe('SUMMARY');
  await act(async () => startCaret().click()); await page.settle();
  expect(startCaret().closest('details')!.open).toBe(true);
});
