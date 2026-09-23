import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, StrictMode, useState } from 'react';
import type { PreviewAction, RunnerEvent } from '@crewstation/contracts';
import type { TaskStreamChannel } from '../features/dev-session/hooks/useTaskStream';
import { usePreviewStatus } from '../features/dev-session/hooks/usePreviewStatus';
import type { PreviewHandle } from '../features/dev-session/hooks/usePreviewStatus';
import type { PreviewCommands } from '../features/dev-session/model/preview/previewStatusStore';
import { DevelopmentPreview } from '../features/dev-session/components/preview/DevelopmentPreview';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; });

/**
 * RFC-016：状态与控制走 cs-api，事件仍走任务流。
 * `streamSends` 存在就是为了断言迁移后工作台不再用 WS 发预览命令。
 */
function transport() {
  const calls: Array<{ type: string; resolve: (value: unknown) => void; reject: (cause: unknown) => void }> = [];
  const streamSends: string[] = [];
  const listeners = new Set<Parameters<TaskStreamChannel['subscribe']>[0]>();
  const pending = (type: string) => new Promise<never>((resolve, reject) => calls.push({ type, resolve: resolve as (value: unknown) => void, reject }));
  const channel: TaskStreamChannel = {
    send: async (input) => { streamSends.push(input.type); return {}; },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const commands: PreviewCommands = { status: () => pending('previewStatus'), control: (action) => pending(action) };
  const reply = (index: number, state = 'ready') => act(async () => calls[index]!.resolve({ state, port: 3000, restarts: 0 }));
  const event = (state: 'ready' | 'crashed') => act(async () => { for (const listener of listeners) listener({ kind: 'previewState', state, port: 3000 } as RunnerEvent, 1); });
  return { calls, channel, commands, reply, event, listeners, streamSends };
}

async function mount(source0: ReturnType<typeof transport>, strict = false) {
  let preview: PreviewHandle, change: (value: { transport: ReturnType<typeof transport>; generation: number; connected: boolean }) => void;
  function Harness() {
    const [source, setSource] = useState({ transport: source0, generation: 1, connected: true }); change = setSource;
    preview = usePreviewStatus(source.transport.channel, 'prj-1', source.generation, source.connected, source.transport.commands);
    return <DevelopmentPreview preview={preview} previewHost="development.localhost" connected={source.connected} />;
  }
  page = await renderElement(strict ? <StrictMode><Harness /></StrictMode> : <Harness />, messages);
  return {
    current: () => preview!,
    change: async (generation: number, connected = true, next = source0) => { await act(async () => change({ transport: next, generation, connected })); },
    act: async (action: PreviewAction) => { await act(async () => preview!.run(action)); },
  };
}

test('预览事件先到时立即确认状态，较早查询的回执和错误不覆盖新状态', async () => {
  const f = transport(), h = await mount(f); await f.event('ready');
  expect(h.current().confirmed).toBe(true); expect(page!.host.querySelector('iframe')?.getAttribute('src')).toBe('//development.localhost');
  await f.reply(0, 'crashed'); expect(h.current().status.state).toBe('ready');
  await act(async () => h.current().refresh()); await f.event('crashed');
  await act(async () => f.calls[1]!.reject(new Error('旧查询失败'))); expect(h.current().status.state).toBe('crashed'); expect(h.current().error).toBeUndefined();
});

test('断开后移除可用预览地址，重连与换任务忽略旧回执；卸载不发送控制动作', async () => {
  const f = transport(), h = await mount(f); await f.reply(0); await act(async () => h.current().refresh());
  await h.change(1, false); expect(h.current().confirmed).toBe(false); expect(page!.host.querySelectorAll('iframe')).toHaveLength(0);
  await f.reply(1); expect(h.current().confirmed).toBe(false); await h.change(2); expect(h.current().confirmed).toBe(false);
  const next = transport(); await h.change(1, true, next); await f.reply(2); expect(h.current().confirmed).toBe(false);
  await next.reply(0); expect(h.current().confirmed).toBe(true); page!.unmount(); page = undefined;
  expect(f.listeners.size + next.listeners.size).toBe(0); expect([...f.calls, ...next.calls].every((c) => c.type === 'previewStatus')).toBe(true);
});

test('控制动作同轮只发一次，读回状态完成前不接受第二次动作或刷新', async () => {
  const f = transport(), h = await mount(f); await f.reply(0);
  await act(async () => { h.current().run('restart'); h.current().run('stop'); h.current().refresh(); });
  expect(f.calls.map((c) => c.type)).toEqual(['previewStatus', 'restart']); expect(h.current().busy).toBe(true);
  await act(async () => f.calls[1]!.resolve({ state: 'starting', restarts: 0 })); expect(f.calls.map((c) => c.type)).toEqual(['previewStatus', 'restart', 'previewStatus']);
  await h.act('restart'); expect(f.calls).toHaveLength(3); await f.reply(2, 'starting'); expect(h.current().busy).toBe(false);
  expect(h.current().status.state).toBe('starting');
});

test('停止与启动各自可达，且都不经任务流发送', async () => {
  const f = transport(), h = await mount(f); await f.reply(0, 'ready');
  expect(page!.button('停止')).toBeTruthy();
  await h.act('stop'); await act(async () => f.calls[1]!.resolve({ state: 'stopped', restarts: 0 })); await f.reply(2, 'stopped');
  expect(h.current().status.state).toBe('stopped'); expect(page!.button('启动')).toBeTruthy();
  await h.act('start'); await act(async () => f.calls[3]!.resolve({ state: 'starting', restarts: 0 })); await f.reply(4, 'starting');
  expect(f.calls.map((c) => c.type)).toEqual(['previewStatus', 'stop', 'previewStatus', 'start', 'previewStatus']);
  expect(f.streamSends).toEqual([]);
});

test('控制动作失败即使状态仍就绪也保留操作错误，读状态不会自动重发动作', async () => {
  const f = transport(), h = await mount(f); await f.reply(0); await h.act('restart');
  await act(async () => f.calls[1]!.reject(new Error('预览命令未受理'))); await f.reply(2);
  expect(page!.text()).toContain('预览命令未受理'); expect(page!.text()).toContain('重启');
  expect(h.current().status.state).toBe('ready'); expect(h.current().busy).toBe(false);
  await f.event('ready'); expect(page!.text()).toContain('预览命令未受理'); expect(f.calls.filter((c) => c.type === 'restart')).toHaveLength(1);
});

test('畸形状态事件不能当作就绪，断线按钮与在途刷新不可重复发送', async () => {
  const f = transport(), h = await mount(f); await f.reply(0);
  await act(async () => { h.current().refresh(); h.current().refresh(); }); expect(f.calls).toHaveLength(2); await f.reply(1);
  await act(async () => { for (const listener of f.listeners) listener({ kind: 'previewState', state: 'not-a-state', message: {} } as unknown as RunnerEvent, 2); });
  expect(h.current().confirmed).toBe(false); expect(page!.host.querySelectorAll('iframe')).toHaveLength(0); expect(page!.text()).toContain('预览状态事件无效');
  await h.change(1, false); await act(async () => { h.current().run('restart'); h.current().refresh(); }); expect(f.calls).toHaveLength(2);
  expect(page!.button('重新加载').disabled).toBe(true); expect(page!.button('重启').disabled).toBe(true);
});

test('StrictMode 中切换连接世代后旧查询不回写，动作在途换任务不跨对象追加读取', async () => {
  const f = transport(), h = await mount(f, true); await h.change(2); expect(f.calls).toHaveLength(2);
  await f.reply(0); expect(h.current().confirmed).toBe(false); await f.reply(1); expect(h.current().confirmed).toBe(true); expect(f.listeners.size).toBe(1);
  await h.act('restart'); const next = transport(); await h.change(1, true, next);
  await act(async () => f.calls[2]!.resolve({ state: 'starting', restarts: 0 })); expect(f.calls).toHaveLength(3); expect(h.current().confirmed).toBe(false);
  await next.reply(0, 'crashed'); expect(h.current().status.state).toBe('crashed'); expect(h.current().error).toBeUndefined();
  expect(next.calls.every((call) => call.type === 'previewStatus')).toBe(true); expect(f.listeners.size).toBe(0);
});

test('预览直接铺进页签：工具栏在预览页之前，不再重复「开发预览」标题，说明收进状态提示', async () => {
  const f = transport(); await mount(f); await f.event('ready');
  const root = page!.host.querySelector('section')!; const [toolbar, frame] = [...root.children];
  expect(toolbar!.tagName).toBe('HEADER'); expect(frame!.tagName).toBe('IFRAME');
  expect(toolbar!.querySelector('strong')).toBeNull(); expect(page!.text()).not.toContain(messages['devSession.native.previewHint']);
  expect(toolbar!.querySelector(`[title="${messages['devSession.native.previewHint']}"]`)?.textContent).toBe('就绪');
  expect([...toolbar!.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['新窗口打开预览']);
});
