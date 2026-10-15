import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { BotComposer } from '../features/dev-session/components/bot/BotComposer';
import { BotTranscript } from '../features/dev-session/components/bot/BotTranscript';
import { appendAgentEvents } from '../features/dev-session/model/agentTranscript';
import { messages } from '../features/dev-session/i18n/zh-CN';
import { renderElement } from './renderElement';
import type { AgentEvent } from '@crewstation/contracts';

let view: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { view?.unmount(); view = undefined; });

const legacyTool = (name: string) => JSON.stringify({ type: 'tool_use', timestamp: 1792056444830, sessionID: 'ses_snake', part: {
  type: 'tool', tool: 'read', callID: name, state: { status: 'completed', input: { filePath: `/work/${name}.ts` }, output: '旧文件内容\n'.repeat(2000) },
} }).slice(0, 8192);
const transcript = (events: readonly Partial<AgentEvent>[]) => appendAgentEvents({}, events.map((event, index) => ({
  agentId: 'bot', seq: index + 1, at: '2026-10-15T12:00:00.000Z', type: 'text' as const, ...event,
}))).bot!;

test('旧贪吃蛇截断工具记录在合并增量前归入执行记录，前后回答仍完整', async () => {
  const first = legacyTool('main'), second = legacyTool('test');
  const lines = transcript([{ text: '开始检查。' }, { text: first }, { text: second }, { text: '完成。' }, { text: '游戏可用。' }]);
  view = await renderElement(<BotTranscript lines={lines} running={false} hasConversation onSuggestion={() => {}} />, messages);
  // 真实故障：旧宿主把每个工具 JSON 截到 8192 字符，fallback text 被合并并当成 Bot 正文。
  const answers = [...view.host.querySelectorAll('article')];
  expect(answers.map(answer => answer.textContent)).toEqual(['Crew Bot开始检查。', 'Crew Bot完成。游戏可用。']);
  const records = view.host.querySelector('details')!;
  expect(records.open).toBe(false);
  expect(records.querySelectorAll('pre')).toHaveLength(2);
  expect(records.textContent).toContain(first); expect(records.textContent).toContain(second);
});

test('正文提到 tool_use、展示 JSON 或来自有效原生文本帧时不会误归为工具', async () => {
  const example = legacyTool('example');
  const texts = ['tool_use 是工具事件。', '{"type":"tool_use","name":"read"}', '{"type":"tool_use","timestamp":1', example];
  const lines = transcript(texts.flatMap((text, index) => [
    { text, ...(index === 3 ? { raw: JSON.stringify({ type: 'text', part: { type: 'text', text } }) } : {}) },
    { type: 'status' as const, status: 'waiting' },
  ]));
  view = await renderElement(<BotTranscript lines={lines} running={false} hasConversation onSuggestion={() => {}} />, messages);
  expect([...view.host.querySelectorAll('article')].map(answer => answer.textContent)).toEqual(texts.map(text => `Crew Bot${text}`));
});

test('Bot 正文、列表和代码全部位于回答气泡内，执行记录保持独立', async () => {
  const lines = transcript([{ type: 'tool-start', tool: { name: 'Read' } }, { text: '已完成。\n\n- 可以开始\n\n```ts\nstartGame();\n```' }]);
  view = await renderElement(<BotTranscript lines={lines} running={false} hasConversation onSuggestion={() => {}} />, messages);
  const answer = view.host.querySelector('article[aria-label="Crew Bot"]')!;
  const bubble = answer?.lastElementChild;
  expect(bubble?.querySelector('p')?.textContent).toBe('已完成。');
  expect(bubble?.querySelector('ul')?.textContent).toBe('可以开始');
  expect(bubble?.querySelector('pre code')?.textContent).toContain('startGame();');
  expect(bubble?.contains(view.host.querySelector('details'))).toBe(false);
});

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
