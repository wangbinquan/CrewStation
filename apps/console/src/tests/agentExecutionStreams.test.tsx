import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { AgentEvent } from '@crewstation/contracts';
import { AgentInstanceDtoSchema } from '@crewstation/contracts';
import { activityProjectId, activityTaskId, activityTime } from './agentActivityFixture';
import { historicalConversationFixture, historyAgentA } from './historicalConversationFixture';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof historicalConversationFixture> | undefined;
afterEach(async () => { page?.unmount(); page = undefined; fixture?.restore(); fixture = undefined; await new Promise((resolve) => setTimeout(resolve, 0)); });
const path = `/projects/${activityProjectId}/dev-session/conversations`;
const execB = `tsk_${'b'.repeat(32)}`, execC = `tsk_${'c'.repeat(32)}`;
const agentB = 'agt_exec_bravo22', agentC = 'agt_exec_charli';
const withExecution = (agentId: string, state: 'running' | 'finished' | 'queued' | 'starting', taskId: string, patch: Record<string, unknown> = {}) =>
  AgentInstanceDtoSchema.parse({ agentId, taskId: activityTaskId, compute: 'standard', permission: 'edit', state: 'running', startedAt: activityTime, profileRevision: 2, execution: { taskId, state }, ...patch });
async function select(agentId: string) {
  const tab = () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => !node.closest('[hidden]') && node.textContent?.startsWith(`L-${agentId.slice(-6)}`));
  const deadline = Date.now() + 2000;
  while (!tab()) {
    if (Date.now() >= deadline) throw new Error(`等待 Agent ${agentId} 页签超时；名册读取 ${fixture?.rosterRequests.length ?? 0} 次；页面：${page?.text()}`);
    await page!.settle();
  }
  await act(async () => tab()!.click()); await page!.settle();
}
/** 转录按 80ms 合批刷新：投递后等过一个刷新周期再断言。 */
async function deliver(taskId: string, event: Omit<AgentEvent, 'seq' | 'at'>, seq?: number) {
  await act(async () => fixture!.receiveAgentOn(taskId, event, seq));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  await page!.settle();
}
const transcript = () => document.querySelector('[role="log"]')?.textContent ?? '';

test('执行环境里的 Agent 从它自己的流进转录；老 Agent 仍从开发会话的流读取（RFC-006）', async () => {
  fixture = historicalConversationFixture();
  fixture.agents.push(withExecution(agentB, 'running', execB));
  page = await renderApp(`${path}?agent=${agentB}`);
  expect(fixture.openStreams(execB)).toBe(1);
  await deliver(execB, { agentId: agentB, type: 'text', text: '来自执行环境' });
  expect(transcript()).toContain('来自执行环境');
  // 执行环境的流里也有生命周期信号：名册据此重读。
  const reads = fixture.rosterRequests.length;
  await deliver(execB, { agentId: agentB, type: 'status', status: 'waiting' });
  expect(fixture.rosterRequests.length).toBe(reads + 1);
  await select(historyAgentA);
  await deliver(activityTaskId, { agentId: historyAgentA, type: 'text', text: '来自开发会话' });
  expect(transcript()).toContain('来自开发会话');
  expect(transcript()).not.toContain('来自执行环境');
  // 未结束的执行环境即使没选中也保持订阅，生命周期信号才能及时到达。
  expect(fixture.openStreams(execB)).toBe(1);
});

for (const delayed of [false, true]) test(`已结束的执行环境：没选中不开流；选中时开流回放，重新挂载后的回放按 seq 去重不翻倍（名册${delayed ? '延迟' : '立即'}返回）`, async () => {
  fixture = historicalConversationFixture();
  fixture.agents.push(withExecution(agentC, 'finished', execC, { state: 'completed', endedAt: activityTime }));
  const fetch = globalThis.fetch;
  let releaseRoster = () => {};
  const rosterReady = new Promise<void>((resolve) => { releaseRoster = resolve; });
  if (delayed) globalThis.fetch = (async (raw, init) => {
    const response = await fetch(raw, init);
    if (new URL(String(raw), 'http://localhost').pathname.endsWith('/agents')) await rosterReady;
    return response;
  }) as typeof fetch;
  page = await renderApp(path);
  expect(fixture.streamsOpened(execC)).toBe(0);
  if (delayed) expect(document.querySelectorAll('[role="tab"]').length).toBe(0);
  // 身份、开发会话与名册分层加载；初始三轮渲染结束不代表名册已到达。
  const selection = select(agentC);
  releaseRoster();
  await selection;
  expect(fixture.openStreams(execC)).toBe(1);
  await deliver(execC, { agentId: agentC, type: 'text', text: '历史输出' }, 1);
  await deliver(execC, { agentId: agentC, type: 'completed' }, 2);
  expect(transcript().match(/历史输出/g)).toHaveLength(1);
  await select(historyAgentA);
  expect(fixture.openStreams(execC)).toBe(0);
  await select(agentC);
  expect(fixture.openStreams(execC)).toBe(1);
  expect(fixture.streamsOpened(execC)).toBe(2);
  // 新连接从头回放同样的 seq：已收下的不再进转录。
  await deliver(execC, { agentId: agentC, type: 'text', text: '历史输出' }, 1);
  await deliver(execC, { agentId: agentC, type: 'completed' }, 2);
  expect(transcript().match(/历史输出/g)).toHaveLength(1);
});

test('执行环境准备中写明排队或调度原因；失败的 Agent 写明原因', async () => {
  fixture = historicalConversationFixture();
  fixture.agents.push(withExecution(agentB, 'starting', execB, { state: 'preparing', execution: { taskId: execB, state: 'starting', message: '等待此Agent的执行容器就绪：0/1 nodes are available' } }));
  fixture.agents.push(withExecution(agentC, 'finished', execC, { state: 'failed', endedAt: activityTime, execution: { taskId: execC, state: 'finished', message: '此Agent的镜像拉取失败（ImagePullBackOff）' } }));
  page = await renderApp(`${path}?agent=${agentB}`);
  expect(page.text()).toContain('此 Agent 的独立执行环境尚未就绪：等待此Agent的执行容器就绪：0/1 nodes are available');
  const tab = (agentId: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => node.textContent?.startsWith(`L-${agentId.slice(-6)}`))!;
  expect(tab(agentB).textContent).toContain('执行环境准备中');
  expect(tab(agentC).textContent).toContain('执行环境失败');
  await select(agentC);
  expect(page.text()).toContain('此 Agent 未能运行：此Agent的镜像拉取失败（ImagePullBackOff）');
  expect(page.text()).not.toContain('此 Agent 的独立执行环境尚未就绪');
});
