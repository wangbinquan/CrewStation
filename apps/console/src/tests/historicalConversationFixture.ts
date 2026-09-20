import { AgentInstanceDtoSchema } from '@crewstation/contracts';
import type { AgentEvent } from '@crewstation/contracts';
import type { StartDevAgentInput } from '@crewstation/api-client';
import { activityProjectId, activityTaskId, activityTime } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';

export const historyAgentA = 'legacy-alpha1', historyAgentB = 'legacy-bravo2';

/** 真实历史路由及 mutation；仅在 HTTP 边界控制每个 Agent 的消息回执。 */
export function historicalConversationFixture() {
  const f = editorWorkspaceFixture(), base = globalThis.fetch;
  const agents = [historyAgentA, historyAgentB].map((agentId) => AgentInstanceDtoSchema.parse({ agentId, taskId: activityTaskId, compute: 'standard', permission: 'edit', state: 'awaiting-input', startedAt: activityTime }));
  const sends: Array<{ agentId: string; content: string; resolve: (response: Response) => void }> = [];
  const starts: Array<{ input: StartDevAgentInput; resolve: (response: Response) => void }> = [];
  const rosterRequests: string[] = [];
  let eventSequence = 1;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path.endsWith('/agents') && (init?.method ?? 'GET') === 'GET') { rosterRequests.push(path); return Response.json({ items: agents }); }
    if (path === `/v1/projects/${activityProjectId}/compute-profiles`) return Response.json({ items: [{ name: 'standard', description: '通用档位', terminalOnly: false, isDefault: true, available: true }, { name: 'fast', description: '快速档位', terminalOnly: false, isDefault: false, available: true }] });
    if (path.endsWith('/agents') && init?.method === 'POST') return new Promise<Response>((resolve) => starts.push({ input: JSON.parse(String(init.body)), resolve }));
    const target = path.match(/\/agents\/([^/]+)\/messages$/);
    if (target && init?.method === 'POST') return new Promise<Response>((resolve) => sends.push({ agentId: target[1]!, content: JSON.parse(String(init.body)).content, resolve }));
    return base(raw, init);
  }) as typeof fetch;
  const finish = (index: number, failed = false) => sends[index]!.resolve(failed ? Response.json({ error: 'unavailable', message: '上游未确认发送结果', details: {} }, { status: 503 }) : new Response(null, { status: 204 }));
  const finishStart = (index: number, failed = false) => {
    if (failed) { starts[index]!.resolve(Response.json({ error: 'unavailable', message: '上游未确认启动结果', details: {} }, { status: 503 })); return; }
    const agent = AgentInstanceDtoSchema.parse({ agentId: `legacy-created-${index}`, taskId: activityTaskId, compute: starts[index]!.input.compute ?? 'standard', permission: starts[index]!.input.permission, state: 'running', startedAt: activityTime });
    agents.push(agent); starts[index]!.resolve(Response.json(agent, { status: 201 }));
  };
  const receiveAgent = (event: Omit<AgentEvent, 'seq' | 'at'>) => {
    const seq = eventSequence++;
    f.receive({ type: 'event', seq, at: activityTime, event: { kind: 'agent', event: { ...event, seq, at: activityTime } } });
  };
  /** 只发给某条流（开发会话或某个 Agent 的执行环境）；seq 可指定，用来模拟重新挂载后的回放。 */
  const receiveAgentOn = (taskId: string, event: Omit<AgentEvent, 'seq' | 'at'>, seq = eventSequence++) => {
    f.receiveFor(taskId, { type: 'event', seq, at: activityTime, event: { kind: 'agent', event: { ...event, seq, at: activityTime } } });
  };
  return { ...f, agents, rosterRequests, receiveAgent, receiveAgentOn, sends, finish, starts, finishStart, restore: () => { for (const [index] of sends.entries()) finish(index, true); for (const [index] of starts.entries()) finishStart(index, true); f.restore(); } };
}
