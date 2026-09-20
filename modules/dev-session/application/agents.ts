import type {
  Actor, AgentEvent, AgentInstanceDto, AgentInstanceState, BeforeStartExecution, RunnerEvent, SendAgentMessageRequest, StartDevAgentRequest, TaskId,
} from '@crewstation/contracts';
import { forbidden, newId, notFound, precondition } from '@crewstation/kernel';
import type { AgentStart, AgentStartRepository } from '../ports/agentStarts';
import type { AgentExecutionLifecycle } from './agentExecution';
import type { DevSessionUseCaseDeps } from './dependencies';

/**
 * 开发会话内的 Agent 都是流式交互（G5）；平台只负责启动、传话与取消，不编排（R04）。
 * RFC-006：每个 Agent 一个执行环境（Pod）。受理时固定档位修订并登记执行环境（占额度），子 Runner 连上后派发；
 * 消息与取消路由到子 Runner。RFC-006 之前在开发容器里起的 Agent 没有受理记录，仍按父任务路由与还原。
 */
export function agentUseCases(deps: DevSessionUseCaseDeps, starts: AgentStartRepository, executions: AgentExecutionLifecycle) {
  const { environments, runner, authorizer } = deps;
  const guard = async (actor: Actor, taskId: TaskId) => {
    const env = await environments.getEnvironment(taskId);
    if (!env) throw notFound('开发会话', taskId);
    await authorizer.authorize(actor, env.projectId, 'develop');
    if (!(await environments.canOpenStream(actor, taskId))) throw forbidden('无权操作该会话');
    if (!env.connected) throw precondition('开发容器尚未连接');
    return env;
  };
  /** 消息与取消的目标 Runner：有受理记录的走它自己的执行环境，老 Agent 走父开发容器。 */
  const target = async (taskId: TaskId, agentId: string): Promise<{ start?: AgentStart; runnerTask: TaskId }> => {
    const start = await starts.get(agentId);
    return start && start.taskId === taskId ? { start, runnerTask: start.execution.taskId } : { runnerTask: taskId };
  };
  return {
    startAgent: async (actor: Actor, taskId: TaskId, input: StartDevAgentRequest): Promise<AgentInstanceDto> => {
      const env = await guard(actor, taskId);
      // RFC-006：受理时解析档位（省略即 default），headless 只能用两种已知协议；此后派发只按固定修订取材料。
      const resolved = await deps.compute.resolve(input.compute, 'agent', env.projectId);
      const start: AgentStart = {
        agentId: newId('agt'), taskId: env.id, createdBy: actor.userId, compute: resolved.id, computeName: resolved.name, profile: { profileId: resolved.id, revision: resolved.revision }, permission: input.permission,
        request: { prompt: input.prompt, ...(input.cwd ? { cwd: input.cwd } : {}), ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}) },
        execution: { taskId: newId('tsk') as TaskId, runnerId: Bun.randomUUIDv7(), image: resolved.image, ...(resolved.taskProfile ? { taskProfile: resolved.taskProfile } : {}) },
        state: 'pending', cursor: 0, finalized: false, createdAt: deps.clock.now().toISOString(),
      };
      await starts.insert(start);
      const execution = await executions.admit(start);
      void executions.dispatch(start.agentId);
      await environments.touch(taskId);
      return { agentId: start.agentId, taskId: env.id, compute: start.compute, computeName: start.computeName, permission: start.permission, state: 'preparing', profileRevision: start.profile.revision,
        execution: { taskId: execution.id, state: execution.native?.state ?? 'queued', ...(execution.message ? { message: execution.message } : {}) }, startedAt: start.createdAt };
    },
    sendMessage: async (actor: Actor, taskId: TaskId, agentId: string, input: SendAgentMessageRequest): Promise<void> => {
      await guard(actor, taskId);
      const { start, runnerTask } = await target(taskId, agentId);
      if (start && start.state !== 'dispatched') throw precondition(start.state === 'pending' ? '此 Agent 还在准备执行环境，请稍后再发' : '此 Agent 已结束');
      await runner.sendCommand(runnerTask, { id: `msg-${newId('m')}`, type: 'sendMessage', agentId, content: input.content });
      await environments.touch(taskId);
    },
    cancelAgent: async (actor: Actor, taskId: TaskId, agentId: string): Promise<void> => {
      await guard(actor, taskId);
      const { start, runnerTask } = await target(taskId, agentId);
      // 还没派发：直接结束并回收执行环境，不再起进程。
      if (start?.state === 'pending') { await executions.end(start, { cancelled: true }); await executions.dispatch(agentId); return; }
      if (start?.state === 'ended') return;
      await runner.sendCommand(runnerTask, { id: `cancel-${agentId}`, type: 'cancelAgent', agentId });
    },
    /** 从各来源（父开发容器与每个 Agent 的执行环境）的持久事件还原每个 Agent 的最新状态。 */
    listAgents: async (actor: Actor, taskId: TaskId): Promise<AgentInstanceDto[]> => {
      const env = await environments.getEnvironment(taskId);
      if (!env) throw notFound('开发会话', taskId);
      await authorizer.authorize(actor, env.projectId, 'view');
      const recorded = await starts.listByTask(taskId);
      const agents = new Map<string, AgentInstanceDto>();
      for (const source of [taskId, ...recorded.map((s) => s.execution.taskId)]) {
        for (const stored of await runner.listEvents(source, { kinds: ['agent', 'beforeStart'], limit: 5000 })) applyStored(agents, taskId, stored);
      }
      for (const start of recorded) agents.set(start.agentId, await withExecution(deps, start, agents.get(start.agentId)));
      return [...agents.values()];
    },
  };
}

function applyStored(agents: Map<string, AgentInstanceDto>, taskId: TaskId, stored: { at: string; event: RunnerEvent }): void {
  if (stored.event.kind === 'beforeStart') { applyBeforeStart(agents, taskId, stored.event.execution, stored.at); return; }
  if (stored.event.kind !== 'agent') return;
  const e = stored.event;
  // 档位与权限只在 started 事件的 spec 里；缺了就如实留空，不编造（权限编错尤其误导人）。
  const current = agents.get(e.event.agentId) ?? { agentId: e.event.agentId, taskId, compute: '', permission: 'read-only' as const, state: 'starting' as AgentInstanceState, startedAt: stored.at };
  const spec = e.event.spec ? { compute: e.event.spec.compute, permission: e.event.spec.permission, profileRevision: e.event.spec.profileRevision } : {};
  agents.set(e.event.agentId, {
    ...current, ...spec, ...(e.event.sessionId ? { sessionId: e.event.sessionId } : {}),
    state: stateOf(e.event, current.state), ...(isTerminal(e.event.type) ? { endedAt: stored.at } : {}),
  });
}

/** 受理记录补齐名册：还没有事件的 Agent 显示为准备中；执行环境的状态与原因（排队、调度、失败）原样带上。 */
async function withExecution(deps: DevSessionUseCaseDeps, start: AgentStart, observed: AgentInstanceDto | undefined): Promise<AgentInstanceDto> {
  const env = start.finalized ? undefined : await deps.environments.getEnvironment(start.execution.taskId);
  const base: AgentInstanceDto = observed ?? { agentId: start.agentId, taskId: start.taskId, compute: start.compute, computeName: start.computeName, permission: start.permission, state: 'preparing', profileRevision: start.profile.revision, startedAt: start.createdAt };
  const state: AgentInstanceState = start.state === 'ended' && !['completed', 'failed', 'cancelled'].includes(base.state) ? (start.cancelled ? 'cancelled' : start.failure ? 'failed' : 'completed') : base.state;
  const executionState = env?.native?.state ?? (start.finalized || start.state === 'ended' ? 'finished' : 'queued');
  const message = start.failure ?? (['queued', 'starting'].includes(executionState) ? env?.message : undefined);
  return { ...base, computeName: start.computeName, compute: base.compute || start.compute, profileRevision: base.profileRevision ?? start.profile.revision, state,
    ...(state !== base.state && start.endedAt ? { endedAt: start.endedAt } : {}), execution: { taskId: start.execution.taskId, state: executionState, ...(message ? { message } : {}) } };
}

/** 启动前步骤的进度只影响“环境准备中／准备失败”，不会被显示成 Agent 正在执行任务（RFC-004、RFC-006）。 */
function applyBeforeStart(agents: Map<string, AgentInstanceDto>, taskId: TaskId, execution: BeforeStartExecution, at: string): void {
  const current = agents.get(execution.agentId) ?? { agentId: execution.agentId, taskId, compute: '', permission: 'read-only' as const, state: 'preparing' as AgentInstanceState, startedAt: at };
  const running = execution.steps.find((s) => s.stepId === execution.currentStepId) ?? execution.steps.find((s) => s.state === 'running');
  const failed = execution.steps.find((s) => s.state === 'failed');
  const beforeStart = { executionId: execution.executionId, state: execution.state, ...(running ? { currentStep: running.name } : {}), ...(failed ? { failedStep: failed.name } : {}), ...(execution.error ? { error: execution.error.message } : {}) };
  const preparing = execution.state === 'queued' || execution.state === 'running';
  const state: AgentInstanceState = preparing ? 'preparing' : execution.state === 'failed' ? 'failed' : execution.state === 'cancelled' ? 'cancelled' : current.state === 'preparing' ? 'starting' : current.state;
  agents.set(execution.agentId, { ...current, compute: current.compute || execution.profile.profileId, profileRevision: execution.profile.revision, beforeStart, state, ...(execution.state === 'failed' || execution.state === 'cancelled' ? { endedAt: execution.endedAt ?? at } : {}) });
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

/** 集群重启生成一个可追踪的新执行；每个 operationId 只登记一次，不复用已结束 Agent。 */
export function clusterAgentUseCases(deps: DevSessionUseCaseDeps, starts: AgentStartRepository, executions: AgentExecutionLifecycle) {
  const load = async (actor: Actor, id: TaskId) => {
    if (!actor.isAdmin) throw forbidden();
    const old = await starts.findByExecution(id); if (!old) throw notFound('开发 Agent', id);
    const env = await deps.environments.getEnvironment(old.taskId); if (!env) throw notFound('父工作区', old.taskId);
    await deps.authorizer.authorize(actor, env.projectId, 'develop'); return { old, env };
  };
  return {
    inspectClusterAgent: async (actor: Actor, id: TaskId) => { const { old } = await load(actor, id); return { parentTaskId: old.taskId, agentId: old.agentId, profile: old.profile, permission: old.permission }; },
    manageClusterAgent: async (actor: Actor, id: TaskId, restart: boolean, operationId: string): Promise<{ operationId: string }> => {
      const { old, env } = await load(actor, id);
      const next = restart ? await starts.reserveRestart(operationId) : undefined;
      await starts.withLock(old.agentId, async () => {
        if (next && !await starts.get(next.agentId)) {
          if (!env.connected || env.state !== 'running') throw precondition('父工作区未就绪，无法重开 Agent');
          await starts.insert({ agentId: next.agentId, taskId: old.taskId, createdBy: actor.userId, compute: old.compute, computeName: old.computeName, profile: old.profile, permission: old.permission, request: old.request,
            execution: { ...old.execution, taskId: next.taskId, runnerId: Bun.randomUUIDv7(), previousTaskId: id }, state: 'pending', cursor: 0, finalized: false, createdAt: deps.clock.now().toISOString() });
        }
        await executions.end((await starts.get(old.agentId))!, { cancelled: true });
      });
      await executions.dispatch(old.agentId);
      return { operationId: next?.taskId ?? id };
    },
  };
}
