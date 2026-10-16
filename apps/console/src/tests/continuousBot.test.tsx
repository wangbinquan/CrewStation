import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { AgentInstanceDtoSchema } from '@crewstation/contracts';
import { continuousBotFixture, botAgentId } from './continuousBotFixture';
import { activityProjectId } from './agentActivityFixture';
import { renderDeliveryHarness } from './renderDeliveryHarness';

let f: ReturnType<typeof continuousBotFixture> | undefined, page: Awaited<ReturnType<typeof renderDeliveryHarness>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; f?.restore(); f = undefined; sessionStorage.clear(); });
const path = `/projects/${activityProjectId}/dev-session?view=guided`;
async function draft(value: string) {
  await act(async () => { const node = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="发给 Agent 的消息"]')!; node.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function firstMessage() {
  f = continuousBotFixture(); page = await renderDeliveryHarness(path);
  await draft('记住我的连续对话'); await page.click('发送');
  await act(async () => f!.finishMessage(0)); await page.settle();
}
test('default Bot does not auto-select legacy Agents; stop and fresh remain distinct explicit actions', async () => {
  await firstMessage();
  expect(document.querySelector('select[aria-label="选择对话"]')).toBeNull(); expect(f!.starts).toHaveLength(0);
  await page!.click('停止本轮'); expect(f!.controls.map(v => v.type)).toEqual(['interrupt']);
  await page!.click('历史与设置'); await page!.click('开启全新上下文');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2); expect(f!.controls).toHaveLength(1);
  await act(async () => document.querySelectorAll('dialog[open]')[1]!.dispatchEvent(new Event('cancel', { cancelable: true })));
  await page!.settle(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  await page!.click('开启全新上下文'); await page!.click('确认开启新上下文'); expect(f!.controls.map(v => v.type)).toEqual(['interrupt', 'context']);
});
test('two executions of one context render in one timeline; refresh and repeated replay preserve answers', async () => {
  await firstMessage();
  const old = f!.bot.conversation!, second = { ...old.execution!, agentId: '01a0bf5d-8f4b-7111-8111-111111111115', initialPrompt: '继续原来的讨论', state: 'awaiting-input' as const };
  f!.bot.history.push(second); f!.bot.conversation = { ...old, state: 'awaiting-input', continuity: 'available', nativeSessionId: 'ses_original', execution: second };
  await page!.reread();
  const replay = async () => { await act(async () => { f!.receiveAgentOn(old.taskId, { agentId: botAgentId, type: 'text', text: '第一轮回答' }, 1); f!.receiveAgentOn(old.taskId, { agentId: second.agentId, type: 'text', text: '恢复后回答' }, 2); await new Promise(resolve => setTimeout(resolve, 100)); }); };
  await replay(); expect([...document.querySelectorAll('article[aria-label="Crew Bot"]')].map(x => x.textContent)).toEqual(['Crew Bot第一轮回答', 'Crew Bot恢复后回答']);
  expect(document.querySelector('[role="log"]')!.textContent!.split('上下文 1')).toHaveLength(2);
  page!.unmount(); page = await renderDeliveryHarness(path); await replay(); await replay();
  expect(document.querySelectorAll('article[aria-label="Crew Bot"]')).toHaveLength(2); expect(f!.botMessages).toHaveLength(1);
});
test('lost HTTP receipt retains exact request across refresh; retry never allocates a different message identity', async () => {
  f = continuousBotFixture(); page = await renderDeliveryHarness(path); await draft('这条请求不能重复执行');
  await page.click('发送'); const original = f.botMessages[0]!.input;
  await act(async () => f!.finishMessage(0, true)); await page.settle();
  expect(document.querySelector('textarea')?.value).toBe(original.content);
  page.unmount(); page = await renderDeliveryHarness(path); expect(f.botMessages).toHaveLength(1);
  await page.click('确认原请求'); expect(f.botMessages).toHaveLength(2); expect(f.botMessages[1]!.input).toEqual(original);
  await act(async () => f!.finishMessage(1)); await page.settle(); expect(document.querySelector('textarea')?.value).toBe('');
  page.unmount(); page = await renderDeliveryHarness(path); expect(document.querySelector('[role="log"]')?.textContent).toContain(original.content);
});
test('long legacy history opens inside shared dialog and keeps the selected last row after reopening', async () => {
  f = continuousBotFixture(); const seed = f.agents[0]!;
  f.agents.splice(0, f.agents.length, ...Array.from({ length: 80 }, (_, i) => AgentInstanceDtoSchema.parse({ ...seed, agentId: `legacy-item-${i}`, initialPrompt: `历史需求 ${i}` })));
  page = await renderDeliveryHarness(path); await page.click('历史与设置');
  expect(document.querySelector('dialog[data-cs-dialog]')?.textContent).toContain('历史需求 79');
  await page.click('历史需求 79'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  expect(document.querySelector('[role="log"]')?.textContent).toContain('历史需求 79');
  await page.click('历史与设置'); await page.click('返回当前 Bot');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(f.starts).toHaveLength(0); expect(f.botMessages).toHaveLength(0);
});
test('startup options keep the user draft on close and refresh, then freeze the selected profile on first send', async () => {
  f = continuousBotFixture(); page = await renderDeliveryHarness(path);
  await page.click('默认算力');
  await act(async () => { const select = document.querySelector<HTMLSelectElement>('#bot-compute')!; select.value = '01a0bf5d-8f4b-7222-8222-222222222222'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.settle();
  await act(async () => document.querySelector('dialog[open]')!.dispatchEvent(new Event('cancel', { cancelable: true })));
  await page.settle(); page.unmount(); page = await renderDeliveryHarness(path);
  await page.click('fast'); expect(document.querySelector<HTMLSelectElement>('#bot-compute')!.value).toBe('01a0bf5d-8f4b-7222-8222-222222222222');
  await page.click('保存设置'); await draft('使用选中的档位'); await page.click('发送');
  expect(f.botMessages[0]!.input.compute).toEqual({ kind: 'profile', profileId: '01a0bf5d-8f4b-7222-8222-222222222222' });
  await act(async () => f!.finishMessage(0)); await page.settle();
  expect([...document.querySelectorAll('[data-bot-composer] button')].some(button => button.textContent === 'fast')).toBe(false);
  expect([...document.querySelectorAll('[data-bot-composer] span')].some(span => span.textContent === 'fast')).toBe(true);
});
