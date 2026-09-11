import type { Actor, AgentInstanceDto, AgentInstanceState, RunnerEvent, SendAgentMessageRequest, StartDevAgentRequest, TaskId } from '@crewstation/contracts';
import { forbidden, newId, notFound, precondition } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from './dependencies';

/** 开发会话内的 Agent 都是流式交互（G5）；平台只负责启动、传话与取消，不编排（R04）。 */
export function agentUseCases(deps: DevSessionUseCaseDeps) {
  const { environments, runner, authorizer, settings } = deps;
  const guard = async (actor: Actor, taskId: TaskId) => {
    const env = await environments.getEnvironment(taskId);
    if (!env) throw notFound('开发会话', taskId);
    await authorizer.authorize(actor, env.projectId, 'develop');
    if (!(await environments.canOpenStream(actor, taskId))) throw forbidden('无权操作该会话');
    if (!env.connected) throw precondition('开发容器尚未连接');
    return env;
  };
  return {
    startAgent: async (actor: Actor, taskId: TaskId, input: StartDevAgentRequest): Promise<AgentInstanceDto> => {
      const env = await guard(actor, taskId);
      const agentId = newId('agt');
      await runner.sendCommand(taskId, {
        id: `start-${agentId}`, type: 'startAgent', agentId, driver: input.driver, model: input.model, permission: input.permission, mode: 'interactive',
        ...(input.cwd ? { cwd: input.cwd } : {}), initialPrompt: input.prompt, ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
        mcp: settings.mcp.map((m) => ({ name: m.name, url: m.url, headers: {} })), env: {},
      });
      await environments.touch(taskId);
      return { agentId, taskId: env.id, driver: input.driver, model: input.model, permission: input.permission, state: 'starting', startedAt: deps.clock.now().toISOString() };
    },
    sendMessage: async (actor: Actor, taskId: TaskId, agentId: string, input: SendAgentMessageRequest): Promise<void> => {
      await guard(actor, taskId);
      await runner.sendCommand(taskId, { id: `msg-${newId('m')}`, type: 'sendMessage', agentId, content: input.content });
      await environments.touch(taskId);
    },
    cancelAgent: async (actor: Actor, taskId: TaskId, agentId: string): Promise<void> => {
      await guard(actor, taskId);
      await runner.sendCommand(taskId, { id: `cancel-${agentId}`, type: 'cancelAgent', agentId });
    },
    /** 从持久事件还原每个 Agent 的最新状态。 */
    listAgents: async (actor: Actor, taskId: TaskId): Promise<AgentInstanceDto[]> => {
      const env = await environments.getEnvironment(taskId);
      if (!env) throw notFound('开发会话', taskId);
      await authorizer.authorize(actor, env.projectId, 'view');
      const agents = new Map<string, AgentInstanceDto>();
      for (const stored of await runner.listEvents(taskId, { kinds: ['agent'], limit: 5000 })) {
        const e = stored.event as Extract<RunnerEvent, { kind: 'agent' }>;
        const current = agents.get(e.event.agentId) ?? { agentId: e.event.agentId, taskId, driver: 'stub', model: '', permission: 'edit', state: 'starting' as AgentInstanceState, startedAt: stored.at };
        agents.set(e.event.agentId, { ...current, ...(e.event.sessionId ? { sessionId: e.event.sessionId } : {}), state: stateOf(e.event.type, current.state), ...(isTerminal(e.event.type) ? { endedAt: stored.at } : {}) });
      }
      return [...agents.values()];
    },
  };
}

function stateOf(type: string, current: AgentInstanceState): AgentInstanceState {
  switch (type) {
    case 'started': case 'session': case 'text': case 'thinking': case 'tool-start': case 'tool-end': case 'status': return 'running';
    case 'permission': return 'awaiting-input';
    case 'completed': return 'completed';
    case 'error': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return current;
  }
}

function isTerminal(type: string): boolean {
  return type === 'completed' || type === 'error' || type === 'cancelled';
}
