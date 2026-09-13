import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, StrictMode, useState } from 'react';
import type { RunnerEvent } from '@crewstation/contracts';
import type { TaskStreamChannel } from '../features/dev-session/hooks/useTaskStream';
import { usePreviewStatus } from '../features/dev-session/hooks/usePreviewStatus';
import type { PreviewHandle } from '../features/dev-session/hooks/usePreviewStatus';
import { DevelopmentPreview } from '../features/dev-session/components/preview/DevelopmentPreview';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; });
function transport() {
  const calls: Array<{ type: string; resolve: (value: unknown) => void; reject: (cause: unknown) => void }> = [];
  const listeners = new Set<Parameters<TaskStreamChannel['subscribe']>[0]>();
  const channel: TaskStreamChannel = { send: (input) => new Promise((resolve, reject) => calls.push({ type: input.type, resolve, reject })), subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const reply = (index: number, state = 'ready') => act(async () => calls[index]!.resolve({ state, port: 3000, restarts: 0 }));
  const event = (state: 'ready' | 'crashed') => act(async () => { for (const listener of listeners) listener({ kind: 'previewState', state, port: 3000 } as RunnerEvent, 1); });
  return { calls, channel, reply, event, listeners };
}
async function mount(channel: TaskStreamChannel, strict = false) {
  let preview: PreviewHandle, change: (value: { channel: TaskStreamChannel; generation: number; connected: boolean }) => void;
  function Harness() {
    const [source, setSource] = useState({ channel, generation: 1, connected: true }); change = setSource;
    preview = usePreviewStatus(source.channel, source.generation, source.connected);
    return <DevelopmentPreview preview={preview} previewHost="development.localhost" connected={source.connected} />;
  }
  page = await renderElement(strict ? <StrictMode><Harness /></StrictMode> : <Harness />, messages);
  return { current: () => preview!, change: async (generation: number, connected = true, next = channel) => { await act(async () => change({ channel: next, generation, connected })); } };
}

test('预览事件先到时立即确认状态，较早查询的回执和错误不覆盖新状态', async () => {
  const f = transport(), h = await mount(f.channel); await f.event('ready');
  expect(h.current().confirmed).toBe(true); expect(page!.host.querySelector('iframe')?.getAttribute('src')).toBe('//development.localhost');
  await f.reply(0, 'crashed'); expect(h.current().status.state).toBe('ready');
  await act(async () => h.current().refresh()); await f.event('crashed');
  await act(async () => f.calls[1]!.reject(new Error('旧查询失败'))); expect(h.current().status.state).toBe('crashed'); expect(h.current().error).toBeUndefined();
});

test('断开后移除可用预览地址，重连与换任务忽略旧回执；卸载不发送重启', async () => {
  const f = transport(), h = await mount(f.channel); await f.reply(0); await act(async () => h.current().refresh());
  await h.change(1, false); expect(h.current().confirmed).toBe(false); expect(page!.host.querySelectorAll('iframe')).toHaveLength(0);
  await f.reply(1); expect(h.current().confirmed).toBe(false); await h.change(2); expect(h.current().confirmed).toBe(false);
  const next = transport(); await h.change(1, true, next.channel); await f.reply(2); expect(h.current().confirmed).toBe(false);
  await next.reply(0); expect(h.current().confirmed).toBe(true); page!.unmount(); page = undefined;
  expect(f.listeners.size + next.listeners.size).toBe(0); expect([...f.calls, ...next.calls].every((c) => c.type === 'previewStatus')).toBe(true);
});

test('重启同轮只发送一次，读回状态完成前不接受第二次重启或刷新', async () => {
  const f = transport(), h = await mount(f.channel); await f.reply(0);
  await act(async () => { h.current().restart(); h.current().restart(); h.current().refresh(); });
  expect(f.calls.map((c) => c.type)).toEqual(['previewStatus', 'restartPreview']); expect(h.current().busy).toBe(true);
  await act(async () => f.calls[1]!.resolve({})); expect(f.calls.map((c) => c.type)).toEqual(['previewStatus', 'restartPreview', 'previewStatus']);
  await act(async () => h.current().restart()); expect(f.calls).toHaveLength(3); await f.reply(2, 'starting'); expect(h.current().busy).toBe(false);
  expect(h.current().status.state).toBe('starting');
});

test('重启失败即使状态仍就绪也保留操作错误，读状态不会自动重发重启', async () => {
  const f = transport(), h = await mount(f.channel); await f.reply(0); await act(async () => h.current().restart());
  await act(async () => f.calls[1]!.reject(new Error('预览命令未受理'))); await f.reply(2);
  expect(page!.text()).toContain('预览命令未受理'); expect(h.current().status.state).toBe('ready'); expect(h.current().busy).toBe(false);
  await f.event('ready'); expect(page!.text()).toContain('预览命令未受理'); expect(f.calls.filter((c) => c.type === 'restartPreview')).toHaveLength(1);
});

test('畸形状态不能当作未启用或就绪，断线按钮与在途刷新不可重复发送', async () => {
  const f = transport(), h = await mount(f.channel);
  await act(async () => f.calls[0]!.resolve({ state: 'unrecognised', restarts: 0 })); expect(h.current().confirmed).toBe(false); expect(h.current().error).toBeTruthy();
  await act(async () => { h.current().refresh(); h.current().refresh(); }); expect(f.calls).toHaveLength(2); await f.reply(1);
  await act(async () => { for (const listener of f.listeners) listener({ kind: 'previewState', state: 'not-a-state', message: {} } as unknown as RunnerEvent, 2); });
  expect(h.current().confirmed).toBe(false); expect(page!.host.querySelectorAll('iframe')).toHaveLength(0); expect(page!.text()).toContain('预览状态事件无效');
  await h.change(1, false); await act(async () => { h.current().restart(); h.current().refresh(); }); expect(f.calls).toHaveLength(2);
  expect(page!.button('刷新').disabled).toBe(true); expect(page!.button('重启').disabled).toBe(true);
});

test('StrictMode 中切换连接世代后旧查询不回写，重启在途换任务不跨对象追加读取', async () => {
  const f = transport(), h = await mount(f.channel, true); await h.change(2); expect(f.calls).toHaveLength(2);
  await f.reply(0); expect(h.current().confirmed).toBe(false); await f.reply(1); expect(h.current().confirmed).toBe(true); expect(f.listeners.size).toBe(1);
  await act(async () => h.current().restart()); const next = transport(); await h.change(1, true, next.channel);
  await act(async () => f.calls[2]!.resolve({})); expect(f.calls).toHaveLength(3); expect(h.current().confirmed).toBe(false);
  await next.reply(0, 'crashed'); expect(h.current().status.state).toBe('crashed'); expect(h.current().error).toBeUndefined();
  expect(next.calls.every((call) => call.type === 'previewStatus')).toBe(true); expect(f.listeners.size).toBe(0);
});
