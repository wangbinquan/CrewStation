import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { NativeTerminalDto, RunnerEvent, TerminalControlState } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { NativeWorkspace } from '../features/dev-session/components/native/NativeWorkspace';
import { NativeTerminalView } from '../features/dev-session/components/native/NativeTerminalView';
import type { TaskStreamChannel } from '../features/dev-session/hooks/useTaskStream';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';
import { INITIAL_STREAM_STATE } from '../features/dev-session/model/taskStreamSocket';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { activityFixture } from './agentActivityFixture';
import { renderElement } from './renderElement';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string }) => void;
  constructor(readonly url: string) { Socket.instances.push(this); }
  receive(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  send(data: string) {
    const command = JSON.parse(data); this.sent.push(command);
    const payload = command.type === 'attachTerminal' ? { terminalId: command.terminalId, runnerId: command.runnerId, cols: 80, rows: 24, data: 'screen', throughSeq: 0, truncated: false, scrollbackLimit: 500 } : command.type === 'claimTerminalControl' ? { controlled: true, expiresAt: '2099-01-01T00:00:00.000Z' } : {};
    queueMicrotask(() => this.receive({ type: 'result', id: command.id, payload }));
  }
  close() { this.readyState = 3; this.onclose?.(); }
}
const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket, originalLocation = window.location.href;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((done) => setTimeout(done, 0)); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; Socket.instances = []; window.location.href = originalLocation; });
const terminal = (name: string, digit: string): NativeTerminalDto => ({ ...activityFixture().terminal, agentId: `agent-${name}`, terminalId: `terminal-${name}`, runnerId: crypto.randomUUID(),
  execution: { taskId: TaskIdSchema.parse(`01a0bf5d-8f4b-7abc-8123-${digit.repeat(12)}`), state: 'running', profile: { name: 'cli', cpu: '1', memory: '2Gi', storage: '2Gi' } } });

test('两窗接入不同 Runner，父连接断开仍能附着；放大另一组只断开显示连接，不停止 CLI', async () => {
  const one = { ...terminal('one', '4'), protocol: 'opencode' as const }, two = { ...terminal('two', '5'), protocol: 'terminal' as const };
  // 旧布局（一个工作区里平铺两窗、没有分屏树）读入后迁移成并排的两组，两窗仍同时显示。
  const { dock: _dock, ...layout } = initialWorkspaceLayout('工作区 1');
  window.location.href = 'http://localhost/';
  layout.tabs[0]!.paneOrder = [one.terminalId, two.terminalId];
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.fetch = (async (raw, init) => {
    const url = String(raw); let body: unknown = { items: [] };
    if (url.endsWith('/workspace-layout')) body = init?.method === 'PUT' ? { ...JSON.parse(String(init.body)), revision: 2, updatedAt: one.startedAt } : { layout, revision: 1, updatedAt: one.startedAt };
    if (url.endsWith('/agent-terminals')) body = { items: [one, two], connection: 'disconnected', runnerId: null, checkedAt: one.startedAt, activitySync: 'ready' };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const parentCommands: unknown[] = [];
  page = await renderElement(<NativeWorkspace projectId="project-1" taskId={one.taskId} userId={one.createdBy} channel={{ send: async (command) => { parentCommands.push(command); return {}; }, subscribe: () => () => {} }} stream={INITIAL_STREAM_STATE} canDevelop onActivity={() => {}} preview={null} editor={null} changes={null} />, messages);
  expect(Socket.instances).toHaveLength(2);
  for (const item of [one, two]) expect(Socket.instances.some((socket) => socket.url.includes(item.execution!.taskId))).toBe(true);
  await act(async () => { for (const socket of Socket.instances) { socket.onopen?.(); socket.receive({ type: 'streamReady', connected: true, replayed: 0, replayComplete: true }); } }); await page.settle();
  for (const item of [one, two]) expect(Socket.instances.find((socket) => socket.url.includes(item.execution!.taskId))?.sent).toContainEqual(expect.objectContaining({ type: 'attachTerminal', terminalId: item.terminalId, runnerId: item.runnerId }));
  expect(parentCommands).toEqual([]); expect(page.text()).toContain('CPU 1');
  // 不再有「获取输入控制」按钮：状态条提示点进终端即可输入，按下终端就自动取得（2026-09-23）。
  expect(page.text()).toContain('点进终端取得输入后可滚动回看会话历史');
  expect(page.text()).toContain('空闲 · 点击终端即可输入');
  expect([...page.host.querySelectorAll('button')].filter((node) => node.textContent === '获取输入控制')).toHaveLength(0);
  await act(async () => page!.host.querySelector('[data-native-terminal="terminal-one"] [role="region"]')!.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))); await page.settle();
  expect(page.text()).toContain('在终端内滚动或拖动右侧滚动条，回看会话历史');
  expect(page.host.querySelector('[data-native-terminal="terminal-one"] [data-control]')?.getAttribute('data-control')).toBe('mine');
  expect(page.host.querySelector('[data-native-terminal="terminal-one"] [data-control]')?.textContent).toContain('你正在输入');
  expect(Socket.instances.find((socket) => socket.url.includes(one.execution!.taskId))?.sent.filter((command) => command.type === 'claimTerminalControl')).toHaveLength(1);
  expect(document.querySelector('[data-native-terminal="terminal-two"] [data-activity]')).toBeNull();
  expect(document.querySelector('[data-native-terminal="terminal-one"] [data-activity]')).not.toBeNull();
  // 双击标签放大 one 所在的组：two 的画面卸载、显示连接断开；one 仍连着，谁的进程都不结束。
  await act(async () => page!.host.querySelector('[data-dock-tab="terminal-one"]')!.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))); await page.settle();
  expect(page.host.querySelector('[data-native-terminal="terminal-two"]')).toBeNull();
  expect(Socket.instances.find((socket) => socket.url.includes(two.execution!.taskId))?.readyState).toBe(3);
  expect(Socket.instances.find((socket) => socket.url.includes(one.execution!.taskId))?.readyState).toBe(1);
  expect(Socket.instances.flatMap((socket) => socket.sent).some((command) => command.type === 'stopAgentTerminal' || command.type === 'startAgentTerminal')).toBe(false);
});

test('已回收的 CLI 按需读取末屏且只读，不再向旧 Runner 发附着或输入命令', async () => {
  const item: NativeTerminalDto = { ...terminal('ended', '6'), lifecycle: 'ended', finalScreen: 'available', connection: 'disconnected' }, calls: string[] = [], commands: unknown[] = [];
  globalThis.fetch = (async (raw) => { calls.push(String(raw)); return new Response(JSON.stringify({ status: 'available', snapshot: { terminalId: item.terminalId, runnerId: item.runnerId, cols: 80, rows: 24, data: 'final screen', throughSeq: 100, truncated: true, scrollbackLimit: 500 } }), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  page = await renderElement(<NativeTerminalView terminal={item} channel={{ send: async (command) => { commands.push(command); return {}; }, subscribe: () => () => {} }} stream={INITIAL_STREAM_STATE} onActivity={() => {}} canDevelop />, messages);
  expect(calls).toEqual([expect.stringContaining(`/agent-terminals/${item.agentId}/snapshot`)]);
  expect(page.text()).toContain('退出时的末屏 · 只读'); expect(page.host.querySelector('[data-control]')).toBeNull(); expect(commands).toEqual([]);
});

test('占用人实时显示：别人取得时状态条写出名字且只读，点进去被拒不报错；对方离开后变回空闲；同一用户的另一窗口单独提示', async () => {
  const item = { ...terminal('shared', '7'), protocol: 'opencode' as const }, viewer = 'user-viewer';
  const holder = { userId: 'user-li', name: '李四' }, claims: unknown[] = [];
  let replyControl: TerminalControlState = { held: true, holder, revision: 1 };
  const listeners = new Set<(event: RunnerEvent, seq: number) => void>();
  const channel: TaskStreamChannel = {
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    send: async (command) => {
      if (command.type === 'attachTerminal') return { terminalId: item.terminalId, runnerId: item.runnerId, cols: 80, rows: 24, data: 'screen', throughSeq: 0, truncated: false, scrollbackLimit: 500, control: { held: false, revision: 0 } };
      if (command.type === 'claimTerminalControl') { claims.push(command); return { controlled: false, expiresAt: null, control: replyControl }; }
      return {};
    },
  };
  const push = (control: TerminalControlState) => act(async () => { for (const listener of listeners) listener({ kind: 'terminalControl', terminalId: item.terminalId, runnerId: item.runnerId, control }, 1); });
  page = await renderElement(<NativeTerminalView terminal={{ ...item, connection: 'connected' }} channel={channel} stream={{ ...INITIAL_STREAM_STATE, runnerConnected: true }} onActivity={() => {}} canDevelop viewerId={viewer} />, messages);
  const bar = () => page!.host.querySelector('[data-control]');
  expect(bar()?.getAttribute('data-control')).toBe('free');
  await push({ held: true, holder, revision: 1 }); await page.settle();
  expect(bar()?.getAttribute('data-control')).toBe('other');
  expect(bar()?.textContent).toContain('李四 正在输入 · 只读');
  await act(async () => page!.host.querySelector('[role="region"]')!.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))); await page.settle();
  expect(claims).toHaveLength(1);
  expect(page.host.querySelector('p[role="status"]')).toBeNull();
  expect(bar()?.textContent).toContain('李四 正在输入');
  await push({ held: false, revision: 2 }); await page.settle();
  expect(bar()?.textContent).toContain('空闲 · 点击终端即可输入');
  replyControl = { held: true, holder: { userId: viewer, name: '我自己' }, revision: 3 };
  await push(replyControl); await page.settle();
  expect(bar()?.getAttribute('data-control')).toBe('self-elsewhere');
  expect(bar()?.textContent).toContain('你在另一个窗口中输入');
});
