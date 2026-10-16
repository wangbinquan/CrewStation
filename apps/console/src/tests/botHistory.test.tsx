import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { AgentInstanceDtoSchema } from '@crewstation/contracts';
import { renderDeliveryHarness } from './renderDeliveryHarness';
import { historicalConversationFixture, historyAgentA, historyAgentB } from './historicalConversationFixture';
import { activityProjectId } from './agentActivityFixture';

let page: Awaited<ReturnType<typeof renderDeliveryHarness>> | undefined;
let fixture: ReturnType<typeof historicalConversationFixture> | undefined;
afterEach(() => { page?.unmount(); page = undefined; fixture?.restore(); fixture = undefined; sessionStorage.clear(); });
const path = `/projects/${activityProjectId}/dev-session?view=guided`;
const chosen = () => [...Array(sessionStorage.length)].map((_, i) => sessionStorage.key(i)!).filter(key => key.startsWith('cs-bot-entry:')).map(key => sessionStorage.getItem(key))[0];
const replies = () => [...page!.host.querySelectorAll('article[aria-label="Crew Bot"]')].map(node => node.textContent);
async function choose(agentId: string) {
  await page!.click('历史与设置');
  await page!.click(`对话 ${agentId === historyAgentA ? 1 : 2}`);
  await page!.settle();
}
async function replay() {
  await act(async () => {
    fixture!.receiveAgent({ agentId: historyAgentA, type: 'text', text: '最初失败的开发回复。' });
    fixture!.receiveAgent({ agentId: historyAgentB, type: 'text', text: '继续开发后的完整回复。' });
    await new Promise(resolve => setTimeout(resolve, 100));
  });
}

test('重新打开 Bot 保留所选历史；相同回放显示相同回复，不回到第一条对话', async () => {
  fixture = historicalConversationFixture(); page = await renderDeliveryHarness(path);
  await replay(); await choose(historyAgentB); const before = replies();
  expect(before).toEqual(['Crew Bot继续开发后的完整回复。']);
  // 真实贪吃蛇故障：选择只存在 React state，页面重挂载后静默切回最初失败的 Agent。
  page.unmount(); page = await renderDeliveryHarness(path); await replay();
  expect(chosen()).toBe(historyAgentB); expect(replies()).toEqual(before);
  await page.click('CLI'); await page.click('Bot 聊天');
  expect(chosen()).toBe(historyAgentB); expect(replies()).toEqual(before);
  await page.go(`/projects/${activityProjectId}`); await page.go(path); await replay();
  expect(chosen()).toBe(historyAgentB); expect(replies()).toEqual(before);
  expect(fixture.starts).toHaveLength(0); expect(fixture.sends).toHaveLength(0);
});

test('默认对话锁定身份，名册顺序变化和刷新都不替换正在看的历史', async () => {
  fixture = historicalConversationFixture(); page = await renderDeliveryHarness(path); await replay(); await choose(historyAgentA);
  expect(chosen()).toBe(historyAgentA);
  fixture.agents.reverse(); await page.reread();
  expect(chosen()).toBe(historyAgentA); expect(replies()).toEqual(['Crew Bot最初失败的开发回复。']);
  page.unmount(); page = await renderDeliveryHarness(path);
  expect(chosen()).toBe(historyAgentA);
});

test('新对话的选择也可恢复，重开页面不会自动执行或显示另一条历史', async () => {
  fixture = historicalConversationFixture(); page = await renderDeliveryHarness(path);
  await choose(historyAgentB); await page.click('历史与设置'); await page.click('返回当前 Bot');
  page.unmount(); page = await renderDeliveryHarness(path); await replay();
  expect(chosen()).toBe(''); expect(replies()).toHaveLength(0);
  expect(fixture.starts).toHaveLength(0); expect(fixture.sends).toHaveLength(0);
});

test('已结束对话在名册延迟到达后接续自己的执行流，重复回放不会重写回复', async () => {
  fixture = historicalConversationFixture();
  const agent = fixture.agents[1]!, taskId = '01a0bf5d-8f4b-7e52-8b45-4a547fd10e4f';
  fixture.agents[1] = AgentInstanceDtoSchema.parse({ ...agent, state: 'completed', execution: { taskId, state: 'finished' } });
  page = await renderDeliveryHarness(path); await choose(historyAgentB); page.unmount();
  const fetch = globalThis.fetch; let release = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async (raw, init) => {
    const response = await fetch(raw, init); if (String(raw).endsWith('/agents')) await ready; return response;
  }) as typeof fetch;
  page = await renderDeliveryHarness(path); expect(fixture.openStreams(taskId)).toBe(0);
  release(); await page.settle(); expect(fixture.openStreams(taskId)).toBe(1);
  await act(async () => {
    for (let i = 0; i < 2; i++) fixture!.receiveAgentOn(taskId, { agentId: historyAgentB, type: 'text', text: '已发布的历史结果。' }, 1);
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  expect(chosen()).toBe(historyAgentB); expect(replies()).toEqual(['Crew Bot已发布的历史结果。']);
});
