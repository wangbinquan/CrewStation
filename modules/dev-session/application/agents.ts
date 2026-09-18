import type {
  Actor, AgentEvent, AgentInstanceDto, AgentInstanceState, BeforeStartExecution, RunnerEvent, SendAgentMessageRequest, ServiceId, StartDevAgentRequest, TaskId,
} from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { forbidden, newId, notFound, precondition } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from './dependencies';
import { profileLaunchFields } from './profileLaunch';

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
      // 连接头在 spawn 时写死、事后改不了，所以每次启动 Agent 现签一枚，而不是续期旧的（Design §5.9）。
      const credential = await deps.credentials.issueDevSessionToken({
        taskId, projectId: env.projectId, serviceId: env.serviceId as ServiceId, userId: actor.userId,
      });
      const headers = { [IDENTITY_HEADERS.devSessionToken]: credential.token };
      // RFC-006：受理时解析档位（省略即 default），headless 只能用两种已知协议；按固定修订取派发材料。
      const resolved = await deps.compute.resolve(input.compute, 'agent');
      const profile = await profileLaunchFields(deps, { profile: resolved.name, revision: resolved.revision }, agentId);
      await runner.sendCommand(taskId, {
        id: `start-${agentId}`, type: 'startAgent', agentId, ...profile,
        permission: input.permission, mode: 'interactive',
        ...(input.cwd ? { cwd: input.cwd } : {}), initialPrompt: input.prompt, ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
        mcp: settings.mcp.map((m) => ({ name: m.name, url: m.url, headers })), env: {},
      });
      await environments.touch(taskId);
      return { agentId, taskId: env.id, compute: resolved.name, permission: input.permission, state: 'preparing', profileRevision: resolved.revision, startedAt: deps.clock.now().toISOString() };
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
      for (const stored of await runner.listEvents(taskId, { kinds: ['agent', 'beforeStart'], limit: 5000 })) {
        if (stored.event.kind === 'beforeStart') { applyBeforeStart(agents, taskId, stored.event.execution, stored.at); continue; }
        const e = stored.event as Extract<RunnerEvent, { kind: 'agent' }>;
        // 档位与权限只在 started 事件的 spec 里；缺了就如实留空，不编造（权限编错尤其误导人）。
        const current = agents.get(e.event.agentId) ?? { agentId: e.event.agentId, taskId, compute: '', permission: 'read-only' as const, state: 'starting' as AgentInstanceState, startedAt: stored.at };
        const spec = e.event.spec ? { compute: e.event.spec.compute, permission: e.event.spec.permission, profileRevision: e.event.spec.profileRevision } : {};
        agents.set(e.event.agentId, {
          ...current, ...spec, ...(e.event.sessionId ? { sessionId: e.event.sessionId } : {}),
          state: stateOf(e.event, current.state), ...(isTerminal(e.event.type) ? { endedAt: stored.at } : {}),
        });
      }
      return [...agents.values()];
    },
  };
}

/** 启动前步骤的进度只影响“环境准备中／准备失败”，不会被显示成 Agent 正在执行任务（RFC-004、RFC-006）。 */
function applyBeforeStart(agents: Map<string, AgentInstanceDto>, taskId: TaskId, execution: BeforeStartExecution, at: string): void {
  const current = agents.get(execution.agentId) ?? { agentId: execution.agentId, taskId, compute: '', permission: 'read-only' as const, state: 'preparing' as AgentInstanceState, startedAt: at };
  const running = execution.steps.find((s) => s.stepId === execution.currentStepId) ?? execution.steps.find((s) => s.state === 'running');
  const failed = execution.steps.find((s) => s.state === 'failed');
  const beforeStart = { executionId: execution.executionId, state: execution.state, ...(running ? { currentStep: running.name } : {}), ...(failed ? { failedStep: failed.name } : {}), ...(execution.error ? { error: execution.error.message } : {}) };
  const preparing = execution.state === 'queued' || execution.state === 'running';
  const state: AgentInstanceState = preparing ? 'preparing' : execution.state === 'failed' ? 'failed' : execution.state === 'cancelled' ? 'cancelled' : current.state === 'preparing' ? 'starting' : current.state;
  agents.set(execution.agentId, { ...current, compute: current.compute || execution.profile.profile, profileRevision: execution.profile.revision, beforeStart, state, ...(execution.state === 'failed' || execution.state === 'cancelled' ? { endedAt: execution.endedAt ?? at } : {}) });
}

function stateOf(event: AgentEvent, current: AgentInstanceState): AgentInstanceState {
  switch (event.type) {
    case 'status':
      if (event.status === 'waiting') return 'awaiting-input';
      if (event.status === 'running') return 'running';
      return current;
    case 'started': case 'session': case 'text': case 'thinking': case 'tool-start': case 'tool-end': return 'running';
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
