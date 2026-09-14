import { AgentInstanceDtoSchema } from '@crewstation/contracts';
import { activityTaskId, activityTime } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';

export const historyAgentA = 'legacy-alpha1', historyAgentB = 'legacy-bravo2';

/** 真实历史路由及 mutation；仅在 HTTP 边界控制每个 Agent 的消息回执。 */
export function historicalConversationFixture() {
  const f = editorWorkspaceFixture(), base = globalThis.fetch;
  const agents = [historyAgentA, historyAgentB].map((agentId) => AgentInstanceDtoSchema.parse({ agentId, taskId: activityTaskId, compute: 'standard', permission: 'edit', state: 'awaiting-input', startedAt: activityTime }));
  const sends: Array<{ agentId: string; content: string; resolve: (response: Response) => void }> = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path.endsWith('/agents') && (init?.method ?? 'GET') === 'GET') return Response.json({ items: agents });
    const target = path.match(/\/agents\/([^/]+)\/messages$/);
    if (target && init?.method === 'POST') return new Promise<Response>((resolve) => sends.push({ agentId: target[1]!, content: JSON.parse(String(init.body)).content, resolve }));
    return base(raw, init);
  }) as typeof fetch;
  const finish = (index: number, failed = false) => sends[index]!.resolve(failed ? Response.json({ error: 'unavailable', message: '上游未确认发送结果', details: {} }, { status: 503 }) : new Response(null, { status: 204 }));
  return { ...f, sends, finish, restore: () => { for (const [index] of sends.entries()) finish(index, true); f.restore(); } };
}
