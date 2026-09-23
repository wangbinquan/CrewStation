import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { NativeTerminalDto, UserId, WorkspaceLayout } from '@crewstation/contracts';
import { NativeWorkspace } from '../features/dev-session/components/native/NativeWorkspace';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import { newGroup } from '../features/dev-session/model/layout/terminalGroups';
import { activityFixture, activityProjectId, activityUserId } from './agentActivityFixture';
import { renderElement } from './renderElement';

/**
 * CLI 区（2026-09-23 裁定：Xshell 式标签组）的交互：每个 CLI 一个标签，× 结束进程并关闭，拖动与右键菜单分屏，
 * 双击放大，F2 改名；页头是唯一的新开入口。只替代 HTTP 边界，布局经真实的存储与规整。
 */
const originalFetch = globalThis.fetch, originalObserver = globalThis.ResizeObserver;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(async () => {
  page?.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.fetch = originalFetch; globalThis.ResizeObserver = originalObserver; document.querySelectorAll('[role="menu"]').forEach((node) => node.remove());
});

const G1 = '01a0bf5d-8f4b-7001-8abc-000000000001';
const base = activityFixture().terminal;
const cli = (name: string, extra: Partial<NativeTerminalDto> = {}): NativeTerminalDto => ({ ...base, agentId: `agent-${name.padStart(6, '0')}`, terminalId: `terminal-${name}`, clientRequestId: crypto.randomUUID(), ...extra });
const mine = cli('mine'), ended = cli('ended', { lifecycle: 'ended', connection: 'disconnected' }), other = cli('other', { createdBy: 'user-zhang' as UserId });
const saved = (panes: string[]): WorkspaceLayout => ({ activeTabId: G1, tabs: [newGroup(G1, '工作区 1', panes)], hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.45, selectedTerminalId: null, maximizedTerminalId: null, dock: { group: G1 } });

function setup(options: { readonly layout?: WorkspaceLayout; readonly start?: NativeTerminalDto } = {}) {
  const saves: WorkspaceLayout[] = [], stops: string[] = [], starts: unknown[] = [];
  let roster = [mine, ended, other];
  globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    let body: unknown = {}, status = 200;
    if (url.pathname.endsWith('/workspace-layout')) {
      if (method === 'PUT') { const input = JSON.parse(String(init?.body)); saves.push(input.layout); body = { layout: input.layout, revision: input.expectedRevision + 1, updatedAt: base.startedAt }; }
      else body = { revision: 1, layout: options.layout ?? saved([mine.terminalId, ended.terminalId]), updatedAt: base.startedAt };
    } else if (url.pathname.endsWith('/stop')) stops.push(decodeURIComponent(url.pathname.split('/').at(-2)!));
    else if (url.pathname.endsWith('/agent-terminals') && method === 'POST') {
      starts.push(JSON.parse(String(init?.body)));
      if (options.start) { roster = [...roster, options.start]; body = options.start; } else { status = 412; body = { error: 'precondition', message: '演示拒绝', details: {} }; }
    } else if (url.pathname.endsWith('/agent-terminals')) body = { items: roster, connection: 'connected', runnerId: base.runnerId, checkedAt: base.startedAt, activitySync: 'ready' };
    else if (url.pathname.endsWith('/members')) body = { items: [{ userId: 'user-zhang', name: '张三', role: 'developer', email: 'zhang@example.com' }] };
    else if (url.pathname.endsWith('/v1/me')) body = { id: activityUserId, name: '我' };
    else body = { items: [{ id: 'profile-1', name: 'balanced', description: '标准', terminalOnly: false, isDefault: true, available: true }] };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { saves, stops, starts };
}
const element = () => <NativeWorkspace projectId={activityProjectId} taskId={base.taskId} userId={activityUserId} channel={{ send: async () => ({}), subscribe: () => () => {} }}
  stream={{ ...INITIAL_STREAM_STATE, status: 'open', runnerConnected: true, generation: 1 }} canDevelop onActivity={() => {}} preview={null} editor={null} changes={null} />;
const groups = () => [...page!.host.querySelectorAll<HTMLElement>('[data-dock-group]')].map((group) => [...group.querySelectorAll<HTMLElement>('[data-dock-tab]')].map((tab) => tab.dataset.dockTab));
const tab = (terminalId: string) => page!.host.querySelector<HTMLElement>(`[data-dock-tab="${terminalId}"]`)!;
const shown = () => [...page!.host.querySelectorAll<HTMLElement>('[data-native-terminal]')].map((card) => card.dataset.nativeTerminal);
const fire = async (target: EventTarget, event: Event) => { await act(async () => { target.dispatchEvent(event); }); await page!.settle(); };
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find((item) => item.textContent?.startsWith(label))!;
const flush = async () => { page!.unmount(); page = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); };

describe('CLI 标签组', () => {
  test('每个 CLI 一个标签：别人开的写上是谁、在运行的自动出现；没有工作区页签、布局菜单与工作区设置，页头是唯一的新开入口', async () => {
    setup(); page = await renderElement(element(), messages);
    expect(groups()).toEqual([[mine.terminalId, ended.terminalId, other.terminalId]]);
    expect(tab(other.terminalId).querySelector('.creator')?.textContent).toBe('张三');
    expect(tab(mine.terminalId).querySelector('.creator')).toBeNull();
    expect(tab(mine.terminalId).textContent).toContain('CLI 00mine'); expect(tab(mine.terminalId).getAttribute('aria-selected')).toBe('true');
    expect(shown()).toEqual([mine.terminalId]);
    expect(page.host.querySelector('button[aria-label="＋ 工作区"]')).toBeNull();
    expect([...page.host.querySelectorAll('summary')].map((node) => node.textContent)).toEqual(['选择算力档位']);
    expect(page.button('创建开发Agent会话')).toBeDefined();
  });

  test('点标签切换显示；已结束的点 × 直接关掉；自己在运行的先确认，确认后结束进程并关掉，名册没跟上也不放回', async () => {
    const f = setup(); page = await renderElement(element(), messages);
    await fire(tab(ended.terminalId), new MouseEvent('click', { bubbles: true })); expect(shown()).toEqual([ended.terminalId]);
    await fire(tab(ended.terminalId).querySelector('button')!, new MouseEvent('click', { bubbles: true }));
    expect(groups()).toEqual([[mine.terminalId, other.terminalId]]); expect(f.stops).toEqual([]);
    await fire(tab(mine.terminalId).querySelector('button[aria-label="结束 CLI 00mine"]')!, new MouseEvent('click', { bubbles: true }));
    expect(page.text()).toContain('结束「CLI 00mine」？'); expect(page.text()).toContain('该 Agent 当前的工作会中止'); expect(f.stops).toEqual([]);
    // 2026-09-23 起是确认弹窗：结束进程不可撤销，确认键红底。
    const stopDialog = document.querySelector('dialog[open][role="alertdialog"]')!;
    expect([...stopDialog.querySelectorAll('button')].find((node) => node.textContent === '结束进程')!.className.split(' ')).toContain('dangerPrimary');
    await page.click('取消'); expect(page.text()).not.toContain('结束「CLI 00mine」？'); expect(groups()).toEqual([[mine.terminalId, other.terminalId]]);
    await fire(tab(mine.terminalId).querySelector('button')!, new MouseEvent('click', { bubbles: true }));
    await page.click('结束进程');
    expect(f.stops).toEqual([mine.agentId]); expect(groups()).toEqual([[other.terminalId]]);
    await flush();
    expect(f.saves.at(-1)?.hiddenTerminalIds).toEqual([ended.terminalId, mine.terminalId]);
  });

  test('结束别人开的 CLI 时确认里写明是谁开的；开的人不在成员名单里时写「其他人」而不是一段用户 ID', async () => {
    setup(); page = await renderElement(element(), messages);
    await fire(tab(other.terminalId).querySelector('button')!, new MouseEvent('click', { bubbles: true }));
    expect(page.text()).toContain('这是 张三 开的 CLI，对方正在用的 Agent 会中止');
    await flush();
    // 2026-09-23 实机：开 CLI 的是不在成员名单里的平台管理员，标签上挂着用户 ID 末六位，和 CLI 自己的短 ID 混在一起。
    const stranger = cli('stranger', { createdBy: '01a0c12a-de09-7005-b0f9-d55a8676540b' as UserId });
    setup({ layout: saved([stranger.terminalId]) });
    const stubbed = globalThis.fetch;
    globalThis.fetch = (async (raw: RequestInfo | URL, init?: RequestInit) => String(raw).endsWith('/agent-terminals') && (init?.method ?? 'GET') === 'GET'
      ? Response.json({ items: [stranger], connection: 'connected', runnerId: stranger.runnerId, checkedAt: stranger.startedAt, activitySync: 'ready' }) : stubbed(raw, init)) as typeof fetch;
    page = await renderElement(element(), messages);
    expect(tab(stranger.terminalId).querySelector('.creator')?.textContent).toBe('其他人');
    expect(tab(stranger.terminalId).textContent).not.toContain('76540b');
  });

});

describe('菜单、放大、分隔线、改名与新开', () => {
  test('右键菜单向右分屏出第二组；双击标签放大所在组、再双击还原；只有一组时菜单里的放大不可用', async () => {
    setup(); page = await renderElement(element(), messages);
    await fire(tab(other.terminalId), new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 40 }));
    expect(menuItem('放大').disabled).toBe(true); expect(menuItem('重命名').textContent).toContain('F2');
    await act(async () => menuItem('向右分屏').click()); await page.settle();
    expect(groups()).toEqual([[mine.terminalId, ended.terminalId], [other.terminalId]]);
    expect(shown()).toEqual([mine.terminalId, other.terminalId].sort());
    await fire(tab(other.terminalId), new MouseEvent('dblclick', { bubbles: true }));
    expect(groups()).toEqual([[other.terminalId]]); expect(shown()).toEqual([other.terminalId]);
    await fire(tab(other.terminalId), new MouseEvent('dblclick', { bubbles: true }));
    expect(groups()).toHaveLength(2);
  });

  test('两组之间的分隔线：方向键每次挪 3%，双击均分，大小记进个人布局', async () => {
    const f = setup(); page = await renderElement(element(), messages);
    await fire(tab(other.terminalId), new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 40 }));
    await act(async () => menuItem('向右分屏').click()); await page.settle();
    const divider = () => page!.host.querySelector<HTMLElement>('[role="separator"][aria-label="拖动调整左右宽度，双击均分"]')!;
    expect(divider().getAttribute('aria-orientation')).toBe('vertical'); expect(divider().getAttribute('aria-valuenow')).toBe('50');
    await fire(divider(), new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(divider().getAttribute('aria-valuenow')).toBe('53');
    await fire(divider(), new MouseEvent('dblclick', { bubbles: true })); expect(divider().getAttribute('aria-valuenow')).toBe('50');
    await fire(divider(), new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await flush();
    expect((f.saves.at(-1)?.dock as { sizes?: number[] } | undefined)?.sizes).toEqual([0.94, 1.06]);
  });

  test('F2 原地改名：回车保存到个人布局，只改自己看到的名字；Esc 放弃', async () => {
    const f = setup(); page = await renderElement(element(), messages);
    await fire(tab(mine.terminalId), new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const input = page.host.querySelector<HTMLInputElement>('input[aria-label="标签名称"]')!;
    expect(input.value).toBe('CLI 00mine');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '前端排错'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await fire(input, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(tab(mine.terminalId).querySelector('.name')?.textContent).toBe('前端排错');
    await fire(tab(mine.terminalId), new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const again = page.host.querySelector<HTMLInputElement>('input[aria-label="标签名称"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(again, '不要'); again.dispatchEvent(new Event('input', { bubbles: true })); });
    await fire(again, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tab(mine.terminalId).querySelector('.name')?.textContent).toBe('前端排错');
    await flush();
    expect(f.saves.at(-1)?.terminalNames).toEqual([{ terminalId: mine.terminalId, name: '前端排错' }]);
  });

  test('页头「创建开发Agent会话」新开的 CLI 落在焦点组、成为当前标签', async () => {
    const fresh = cli('fresh'), f = setup({ start: fresh }); page = await renderElement(element(), messages);
    await page.click('创建开发Agent会话');
    expect(f.starts).toHaveLength(1); expect(groups()).toEqual([[mine.terminalId, ended.terminalId, other.terminalId, fresh.terminalId]]);
    expect(tab(fresh.terminalId).getAttribute('aria-selected')).toBe('true'); expect(shown()).toEqual([fresh.terminalId]);
  });
});

describe('拖动标签排列', () => {
  const rect = (element: Element, left: number, top: number, right: number, bottom: number) => Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) });
  async function twoGroups() {
    await fire(tab(other.terminalId), new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 40 }));
    await act(async () => menuItem('向右分屏').click()); await page!.settle();
    const [left, right] = [...page!.host.querySelectorAll<HTMLElement>('[data-dock-group]')].sort((a, b) => a.querySelectorAll('[data-dock-tab]').length - b.querySelectorAll('[data-dock-tab]').length).reverse();
    rect(left!.querySelector('[data-dock-bar]')!, 0, 0, 600, 30); rect(left!.querySelector('[data-dock-body]')!, 0, 30, 600, 630);
    rect(right!.querySelector('[data-dock-bar]')!, 606, 0, 1206, 30); rect(right!.querySelector('[data-dock-body]')!, 606, 30, 1206, 630);
    [...left!.querySelectorAll('[data-dock-tab]')].forEach((node, index) => rect(node, index * 100, 0, index * 100 + 100, 30));
    rect(right!.querySelector('[data-dock-tab]')!, 606, 0, 706, 30);
  }
  const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 7 });

  test('拖到另一组画面的右边：拖动中标出落点区与跟手的名字，松开分出新组；拖到别组标签栏是移过去', async () => {
    setup(); page = await renderElement(element(), messages); await twoGroups();
    const source = tab(mine.terminalId);
    await fire(source, pointer('pointerdown', 20, 10)); await fire(source, pointer('pointermove', 1190, 300));
    expect(page.host.querySelector('[data-zone="right"]')).not.toBeNull(); expect(page.host.textContent).toContain('CLI 00mine');
    await fire(source, pointer('pointerup', 1190, 300));
    expect(page.host.querySelector('[data-zone]')).toBeNull();
    expect(groups()).toHaveLength(3); expect(groups()).toContainEqual([mine.terminalId]);
    await twoGroupsRemeasure();
    const moving = tab(ended.terminalId);
    await fire(moving, pointer('pointerdown', 20, 10)); await fire(moving, pointer('pointermove', 700, 15)); await fire(moving, pointer('pointerup', 700, 15));
    expect(groups()).toContainEqual([other.terminalId, ended.terminalId]);
  });

  async function twoGroupsRemeasure() {
    const all = [...page!.host.querySelectorAll<HTMLElement>('[data-dock-group]')];
    const find = (terminalId: string) => all.find((group) => group.querySelector(`[data-dock-tab="${terminalId}"]`))!;
    const left = find(ended.terminalId), right = find(other.terminalId);
    rect(left.querySelector('[data-dock-bar]')!, 0, 0, 600, 30); rect(left.querySelector('[data-dock-body]')!, 0, 30, 600, 630); rect(left.querySelector('[data-dock-tab]')!, 0, 0, 100, 30);
    rect(right.querySelector('[data-dock-bar]')!, 606, 0, 1206, 30); rect(right.querySelector('[data-dock-body]')!, 606, 30, 1206, 630); rect(right.querySelector('[data-dock-tab]')!, 606, 0, 706, 30);
    for (const group of all.filter((node) => node !== left && node !== right)) { rect(group.querySelector('[data-dock-bar]')!, 2000, 0, 2100, 30); rect(group.querySelector('[data-dock-body]')!, 2000, 30, 2100, 630); }
  }

  test('拖动中按 Esc 放弃：落点区消失、布局不变；没有越过阈值的按下只是点选', async () => {
    const f = setup(); page = await renderElement(element(), messages); await twoGroups();
    const before = groups(), saves = f.saves.length, source = tab(mine.terminalId);
    await fire(source, pointer('pointerdown', 20, 10)); await fire(source, pointer('pointermove', 1190, 300));
    await fire(window, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(page.host.querySelector('[data-zone]')).toBeNull();
    await fire(source, pointer('pointerup', 1190, 300)); expect(groups()).toEqual(before);
    await fire(tab(ended.terminalId), pointer('pointerdown', 110, 10)); await fire(tab(ended.terminalId), pointer('pointermove', 112, 11)); await fire(tab(ended.terminalId), pointer('pointerup', 112, 11));
    expect(groups()).toEqual(before); expect(f.saves.length).toBe(saves);
  });

  test('区域放不下分屏时只显示焦点组、标签栏列出全部 CLI；不能拖，菜单里的分屏不可用并说明原因', async () => {
    const observers: ResizeObserverCallback[] = [];
    globalThis.ResizeObserver = class { constructor(callback: ResizeObserverCallback) { observers.push(callback); } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    setup(); page = await renderElement(element(), messages); await twoGroups();
    await act(async () => { for (const notify of observers) notify([{ contentRect: { width: 400, height: 500 } } as ResizeObserverEntry], {} as ResizeObserver); }); await page.settle();
    expect(groups()).toEqual([[mine.terminalId, ended.terminalId, other.terminalId]]); expect(shown()).toHaveLength(1);
    await fire(tab(mine.terminalId), pointer('pointerdown', 20, 10)); await fire(tab(mine.terminalId), pointer('pointermove', 300, 300));
    expect(page.host.querySelector('[data-zone]')).toBeNull(); await fire(tab(mine.terminalId), pointer('pointerup', 300, 300));
    await fire(tab(mine.terminalId), new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 40 }));
    expect(menuItem('向左分屏').disabled).toBe(true); expect(menuItem('向左分屏').title).toBe('CLI 区太窄，放不下分屏');
  });
});
