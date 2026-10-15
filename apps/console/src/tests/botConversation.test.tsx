import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { BotComposer } from '../features/dev-session/components/bot/BotComposer';
import { BotTranscript } from '../features/dev-session/components/bot/BotTranscript';
import { appendAgentEvents } from '../features/dev-session/model/agentTranscript';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';

let view: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { view?.unmount(); view = undefined; });

test('历史流恢复用户输入、工具失败及回答，代码安全转义，成功过程默认收起', async () => {
  const lines = appendAgentEvents({}, [
    { type: 'user-message' as const, text: '做一个贪吃蛇游戏' },
    { type: 'tool-start' as const, tool: { name: 'Read' } },
    { type: 'tool-end' as const, tool: { name: 'Read' } },
    { type: 'text' as const, text: '**已完成**\n\n- 方向键移动\n- 撞墙结束\n\n```html\n<img src=x onerror=alert(1)>\n```' },
    { type: 'tool-end' as const, tool: { name: 'Build', isError: true } },
  ].map((event, index) => ({ ...event, agentId: 'bot', seq: index + 1, at: new Date().toISOString() }))).bot!;
  view = await renderElement(<BotTranscript lines={lines} running={false} hasConversation onSuggestion={() => {}} />, messages);
  expect(view.host.querySelector('article[aria-label="你"]')?.textContent).toBe('做一个贪吃蛇游戏');
  expect(view.host.querySelector('strong')?.textContent).toBe('Crew Bot'); expect(view.host.querySelector('ul')?.children).toHaveLength(2);
  expect(view.host.querySelector('img')).toBeNull(); expect(view.host.querySelector('pre code')?.textContent).toContain('<img');
  const details = view.host.querySelectorAll('details'); expect(details[0]?.open).toBe(false); expect(details[1]?.open).toBe(true);
});

test('中文输入法确认和 Shift Enter 不发送，普通 Enter 发送；执行和算力入口可用', async () => {
  let sent = 0, cancelled = 0, options = 0;
  view = await renderElement(<BotComposer draft="新需求" disabled={false} sending={false} onDraftChange={() => {}} onSend={() => sent++}
    canCancel onCancel={() => cancelled++} compute="默认算力" onOptions={() => options++} />, messages);
  const input = view.host.querySelector('textarea')!; await act(async () => input.focus());
  for (const detail of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Enter', shiftKey: true }]) {
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...detail })));
  }
  expect(sent).toBe(0); await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); expect(sent).toBe(1);
  await view.click('停止执行'); expect(cancelled).toBe(1); await view.click('默认算力'); expect(options).toBe(1);
});

test('发送未确认时保留消息并禁用重复发送；失败原因可见', async () => {
  let sent = 0;
  view = await renderElement(<BotComposer draft="保留这条需求" disabled={false} sending error="上游未确认发送结果" onDraftChange={() => {}} onSend={() => sent++}
    canCancel={false} onCancel={() => {}} compute="默认算力" />, messages);
  expect(view.host.querySelector('textarea')?.value).toBe('保留这条需求'); expect(view.text()).toContain('上游未确认发送结果');
  expect(view.button('发送中…').disabled).toBe(true); await view.click('发送中…'); expect(sent).toBe(0);
});
