import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { NativeTerminalDto } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { NativeWorkspace } from '../features/dev-session/components/native/NativeWorkspace';
import { NativeTerminalView } from '../features/dev-session/components/native/NativeTerminalView';
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
    const payload = command.type === 'attachTerminal' ? { terminalId: command.terminalId, runnerId: command.runnerId, cols: 80, rows: 24, data: 'screen', throughSeq: 0, truncated: false, scrollbackLimit: 500 } : {};
    queueMicrotask(() => this.receive({ type: 'result', id: command.id, payload }));
  }
  close() { this.readyState = 3; this.onclose?.(); }
}
const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket, originalLocation = window.location.href;
let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; await new Promise((done) => setTimeout(done, 0)); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; Socket.instances = []; window.location.href = originalLocation; });
const terminal = (name: string, digit: string): NativeTerminalDto => ({ ...activityFixture().terminal, agentId: `agent-${name}`, terminalId: `terminal-${name}`, runnerId: crypto.randomUUID(),
  execution: { taskId: TaskIdSchema.parse(`tsk_${digit.repeat(32)}`), state: 'running', profile: { name: 'cli', cpu: '1', memory: '2Gi', storage: '2Gi' } } });

test('两窗接入不同 Runner，父连接断开仍能附着；切页签只关显示连接，不停止 CLI', async () => {
  const one = terminal('one', '4'), two = { ...terminal('two', '5'), protocol: 'terminal' as const }, layout = initialWorkspaceLayout('工作区 1');
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
  page = await renderElement(<NativeWorkspace taskId={one.taskId} userId={one.createdBy} channel={{ send: async (command) => { parentCommands.push(command); return {}; }, subscribe: () => () => {} }} stream={INITIAL_STREAM_STATE} canDevelop onActivity={() => {}} preview={null} editor={null} changes={null} />, messages);
  expect(Socket.instances).toHaveLength(2);
  for (const item of [one, two]) expect(Socket.instances.some((socket) => socket.url.includes(item.execution!.taskId))).toBe(true);
  await act(async () => { for (const socket of Socket.instances) { socket.onopen?.(); socket.receive({ type: 'streamReady', connected: true, replayed: 0, replayComplete: true }); } }); await page.settle();
  for (const item of [one, two]) expect(Socket.instances.find((socket) => socket.url.includes(item.execution!.taskId))?.sent).toContainEqual(expect.objectContaining({ type: 'attachTerminal', terminalId: item.terminalId, runnerId: item.runnerId }));
  expect(parentCommands).toEqual([]); expect(page.text()).toContain('CPU 1');
  expect(document.querySelector('[data-native-terminal="terminal-two"] [data-activity]')).toBeNull();
  expect(document.querySelector('[data-native-terminal="terminal-one"] [data-activity]')).not.toBeNull();
  await page.click('＋ 页签');
  expect(Socket.instances.every((socket) => socket.readyState === 3)).toBe(true);
  expect(Socket.instances.flatMap((socket) => socket.sent).some((command) => command.type === 'stopAgentTerminal' || command.type === 'startAgentTerminal')).toBe(false);
});

test('已回收的 CLI 按需读取末屏且只读，不再向旧 Runner 发附着或输入命令', async () => {
  const item: NativeTerminalDto = { ...terminal('ended', '6'), lifecycle: 'ended', finalScreen: 'available', connection: 'disconnected' }, calls: string[] = [], commands: unknown[] = [];
  globalThis.fetch = (async (raw) => { calls.push(String(raw)); return new Response(JSON.stringify({ status: 'available', snapshot: { terminalId: item.terminalId, runnerId: item.runnerId, cols: 80, rows: 24, data: 'final screen', throughSeq: 100, truncated: true, scrollbackLimit: 500 } }), { headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  page = await renderElement(<NativeTerminalView terminal={item} channel={{ send: async (command) => { commands.push(command); return {}; }, subscribe: () => () => {} }} stream={INITIAL_STREAM_STATE} onActivity={() => {}} canDevelop />, messages);
  expect(calls).toEqual([expect.stringContaining(`/agent-terminals/${item.agentId}/snapshot`)]);
  expect(page.text()).toContain('退出时的末屏 · 只读'); expect(page.text()).not.toContain('获取输入控制'); expect(commands).toEqual([]);
});
