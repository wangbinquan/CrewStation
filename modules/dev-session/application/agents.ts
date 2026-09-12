import type {
  Actor, AgentInstanceDto, AgentInstanceState, RunnerEvent, SendAgentMessageRequest, ServiceId, StartDevAgentRequest, TaskId,
} from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { forbidden, newId, notFound, precondition, validation } from '@crewstation/kernel';
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
  /**
   * 档位名 → 具体驱动与模型（RFC-001）。省略时用平台默认档。
   * 默认档不存在时报 precondition 而不是随便挑一档：静默挑会让业务以为自己拿到了预期算力。
   */
  const resolveCompute = async (name: string | undefined) => {
    const wanted = name ?? settings.defaultComputeProfile;
    const profile = await deps.compute.resolve(wanted);
    if (profile) return profile;
    if (name === undefined) throw precondition(`平台默认算力档位 ${wanted} 不存在，请管理员先在平台管理里配置`, { defaultComputeProfile: wanted });
    const available = (await deps.compute.list()).map((p) => p.name);
    throw validation(`算力档位 ${wanted} 不存在`, { available });
  };
  return {
    startAgent: async (actor: Actor, taskId: TaskId, input: StartDevAgentRequest): Promise<AgentInstanceDto> => {
      const env = await guard(actor, taskId);
      const agentId = newId('agt');
      // 连接头在 spawn 时写死、事后改不了，所以每次启动 Agent 现签一枚，而不是续期旧的（Design §5.9）。
      const credential = await deps.credentials.issueDevSessionToken({
        taskId, projectId: env.projectId, serviceId: env.serviceId as ServiceId, userId: actor.userId,
      });
      const headers = { [IDENTITY_HEADERS.devSessionToken]: credential.token };
      const compute = await resolveCompute(input.compute);
      await runner.sendCommand(taskId, {
        id: `start-${agentId}`, type: 'startAgent', agentId, compute: compute.name, driver: compute.driver, model: compute.model,
        permission: input.permission, mode: 'interactive',
        ...(input.cwd ? { cwd: input.cwd } : {}), initialPrompt: input.prompt, ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
        mcp: settings.mcp.map((m) => ({ name: m.name, url: m.url, headers })), env: {},
      });
      await environments.touch(taskId);
      return { agentId, taskId: env.id, compute: compute.name, permission: input.permission, state: 'starting', startedAt: deps.clock.now().toISOString() };
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
        // 档位与权限只在 started 事件的 spec 里；缺了就如实留空，不编造（权限编错尤其误导人）。
        const current = agents.get(e.event.agentId) ?? { agentId: e.event.agentId, taskId, compute: '', permission: 'read-only' as const, state: 'starting' as AgentInstanceState, startedAt: stored.at };
        const spec = e.event.spec ? { compute: e.event.spec.compute, permission: e.event.spec.permission } : {};
        agents.set(e.event.agentId, {
          ...current, ...spec, ...(e.event.sessionId ? { sessionId: e.event.sessionId } : {}),
          state: stateOf(e.event.type, current.state), ...(isTerminal(e.event.type) ? { endedAt: stored.at } : {}),
        });
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
