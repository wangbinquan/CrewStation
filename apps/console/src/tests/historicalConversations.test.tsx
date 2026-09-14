import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { AgentEvent } from '@crewstation/contracts';
import { activityProjectId } from './agentActivityFixture';
import { historicalConversationFixture, historyAgentA, historyAgentB } from './historicalConversationFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof historicalConversationFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; fixture?.restore(); fixture = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); });
const cliPath = `/projects/${activityProjectId}/dev-session`, path = `${cliPath}/conversations`;
const input = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="发给 Agent 的消息"]')!;
const button = (label: string) => [...document.querySelectorAll('button')].find((node) => node.textContent === label)!;
async function edit(text: string) {
  await act(async () => { const node = input(); node.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function select(agentId: string) {
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => node.textContent?.startsWith(`L-${agentId.slice(-6)}`))!.click()); await page!.settle();
}
async function finish(index: number, failed = false) { await act(async () => fixture!.finish(index, failed)); await page!.settle(); }
async function receive(...events: Array<Omit<AgentEvent, 'seq' | 'at'>>) { await act(async () => { for (const event of events) fixture!.receiveAgent(event); }); await page!.settle(); }
const rosterTab = (agentId: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => node.textContent?.startsWith(`L-${agentId.slice(-6)}`))!;

test('历史 Agent 草稿按对象保留，切换、新建取消与发送失败均不清空或发给另一对象', async () => {
  fixture = historicalConversationFixture(); page = await renderApp(`${path}?agent=${historyAgentA}`);
  await edit('仅给 A 的草稿'); await select(historyAgentB);
  // 原输入框跨 Agent 复用同一 draft，选择 B 会把 A 的未发送内容带过去。
  expect(input().value).toBe(''); await edit('仅给 B 的草稿'); await select(historyAgentA); expect(input().value).toBe('仅给 A 的草稿');
  await page.click('新建 Agent'); await act(async () => button('返回').click()); await page.settle(); expect(input().value).toBe('仅给 A 的草稿');
  await page.click('发送'); expect(fixture.sends).toHaveLength(1); expect(fixture.sends[0]).toMatchObject({ agentId: historyAgentA, content: '仅给 A 的草稿' });
  await finish(0, true); expect(input().value).toBe('仅给 A 的草稿'); expect(page.text()).toContain('上游未确认发送结果');
  await select(historyAgentB); expect(input().value).toBe('仅给 B 的草稿'); expect(page.text()).not.toContain('上游未确认发送结果');
  await select(historyAgentA); expect(input().value).toBe('仅给 A 的草稿'); expect(fixture.sends).toHaveLength(1);
});

test('发送在途时重复快捷键只发送一次；成功回执不清除随后编辑的新内容', async () => {
  fixture = historicalConversationFixture(); page = await renderApp(path); await edit('第一条消息');
  // 按钮 disabled 曾被 Ctrl+Enter 绕过；同步连续事件也必须只派发一次。
  await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })); }); await page.settle();
  expect(fixture.sends).toHaveLength(1); expect(input().value).toBe('第一条消息');
  await edit('回执前继续写的新内容');
  await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))); await page.settle(); expect(fixture.sends).toHaveLength(1);
  await finish(0); expect(input().value).toBe('回执前继续写的新内容'); expect(document.activeElement).toBe(input());
  await page.click('发送'); await finish(1); expect(input().value).toBe('');
});

test('不同历史 Agent 可并行发送，各自的成功和失败只更新对应草稿', async () => {
  fixture = historicalConversationFixture(); page = await renderApp(path); await edit('A 消息'); await page.click('发送');
  await select(historyAgentB); await edit('B 消息'); expect(button('发送').disabled).toBe(false); await page.click('发送'); expect(fixture.sends).toHaveLength(2);
  await finish(0, true); expect(input().value).toBe('B 消息'); expect(button('发送中…').disabled).toBe(true);
  await finish(1); expect(input().value).toBe(''); await select(historyAgentA); expect(input().value).toBe('A 消息'); expect(page.text()).toContain('上游未确认发送结果');
});

test('返回 CLI 先保护未发送输入，在途不允许放弃，取消保留原对象和草稿', async () => {
  fixture = historicalConversationFixture(); page = await renderApp(path); await edit('尚未发送的历史消息');
  await page.click('← 返回 CLI 工作区'); expect(page.path()).toBe(path); expect(page.text()).toContain('历史对话输入有未保存的输入');
  await page.click('继续编辑'); expect(input().value).toBe('尚未发送的历史消息');
  await page.click('发送'); await page.click('← 返回 CLI 工作区'); expect(button('放弃输入并离开').disabled).toBe(true);
  await finish(0, true); expect(button('放弃输入并离开').disabled).toBe(false); await page.click('继续编辑'); expect(input().value).toBe('尚未发送的历史消息');
  await page.click('← 返回 CLI 工作区'); await page.click('放弃输入并离开'); expect(page.path()).toBe(cliPath);
  expect(fixture.commands.some((command) => ['startAgentTerminal', 'closeTerminal', 'stopAgent', 'stopAgentTerminal', 'terminalInput'].includes(command.type))).toBe(false);
});

test('未知历史链接不回落到另一 Agent，选择已有对象和同页链接切换保留各自草稿', async () => {
  fixture = historicalConversationFixture(); page = await renderApp(`${path}?agent=missing-agent`);
  expect(input().disabled).toBe(true); expect(page.text()).toContain('指定的历史 Agent 不存在或当前不可访问');
  expect(document.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(0);
  await select(historyAgentA); await edit('A 的独立输入'); await page.navigate(`${path}?agent=${historyAgentB}`); expect(input().value).toBe('');
  await edit('B 的独立输入'); await page.navigate(`${path}?agent=${historyAgentA}`); expect(input().value).toBe('A 的独立输入');
  expect(fixture.sends).toHaveLength(0);
});

test('历史等待和权限事件刷新对应名册，后台 Agent 状态变化保留当前草稿和焦点', async () => {
  fixture = historicalConversationFixture();
  const [a, b] = fixture.agents; a!.state = 'running'; b!.state = 'running';
  page = await renderApp(`${path}?agent=${historyAgentA}`); await edit('等待状态到达前的草稿');
  let reads = fixture.rosterRequests.length;
  a!.state = 'awaiting-input';
  await receive({ agentId: historyAgentA, type: 'status', status: 'waiting' });
  // API 已正确返回 awaiting-input，原页面忽略 waiting 事件，仍沿用初次读取的执行中标签。
  expect(rosterTab(historyAgentA).textContent).toContain('等待输入'); expect(fixture.rosterRequests).toHaveLength(++reads);
  await receive({ agentId: historyAgentA, type: 'status', status: 'diagnostic information' });
  expect(fixture.rosterRequests).toHaveLength(reads);
  b!.state = 'awaiting-input'; await receive({ agentId: historyAgentB, type: 'permission', text: '请确认后继续' });
  expect(rosterTab(historyAgentB).textContent).toContain('等待输入'); expect(fixture.rosterRequests).toHaveLength(++reads);
  expect(rosterTab(historyAgentA).getAttribute('aria-selected')).toBe('true');
  expect(input().value).toBe('等待状态到达前的草稿'); expect(document.activeElement).toBe(input());
  a!.state = 'running'; await receive({ agentId: historyAgentA, type: 'status', status: 'running' });
  expect(rosterTab(historyAgentA).textContent).toContain('运行中'); expect(fixture.rosterRequests).toHaveLength(++reads);
  await receive(...Array.from({ length: 30 }, () => ({ agentId: historyAgentA, type: 'text' as const, text: '片段' })));
  expect(fixture.rosterRequests).toHaveLength(reads);
  a!.state = 'completed'; await receive({ agentId: historyAgentA, type: 'completed' });
  expect(rosterTab(historyAgentA).textContent).toContain('已完成'); expect(input().disabled).toBe(true);
  expect(input().value).toBe('等待状态到达前的草稿'); expect(fixture.sends).toHaveLength(0);
});

test.each(['text', 'thinking', 'tool-start', 'tool-end'] as const)('旧驱动下一轮从 %s 开始也刷新执行态，连续输出只重读一次', async (type) => {
  fixture = historicalConversationFixture(); page = await renderApp(path);
  let reads = fixture.rosterRequests.length;
  const event = { agentId: historyAgentA, type, text: '实际输出', tool: { name: 'read' } };
  fixture.agents[0]!.state = 'running'; await receive(event);
  expect(rosterTab(historyAgentA).textContent).toContain('运行中'); expect(fixture.rosterRequests).toHaveLength(++reads);
  await receive(...Array.from({ length: 30 }, () => event)); expect(fixture.rosterRequests).toHaveLength(reads);
  fixture.agents[0]!.state = 'awaiting-input'; await receive({ agentId: historyAgentA, type: 'status', status: 'waiting' });
  expect(rosterTab(historyAgentA).textContent).toContain('等待输入'); expect(fixture.rosterRequests).toHaveLength(++reads);
  fixture.agents[0]!.state = 'running'; await receive(event);
  expect(rosterTab(historyAgentA).textContent).toContain('运行中'); expect(fixture.rosterRequests).toHaveLength(++reads);
  expect(fixture.sends).toHaveLength(0);
});
