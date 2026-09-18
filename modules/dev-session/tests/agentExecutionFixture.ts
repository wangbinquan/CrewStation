import type { RunnerCommand, RunnerEvent, TaskId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import { AgentExecutionLifecycle } from '../application/agentExecution';
import { agentUseCases } from '../application/agents';
import type { AgentStart, AgentStartRepository } from '../ports/agentStarts';
import type { CreateExecutionInput, EnvironmentView } from '../ports/runtime';
import { workspaceFixture, workspaceTask } from './workspaceFixture';

export function memoryAgentStarts(): AgentStartRepository & { rows: Map<string, AgentStart> } {
  const rows = new Map<string, AgentStart>();
  return {
    rows,
    insert: async (start) => { rows.set(start.agentId, structuredClone(start)); },
    get: async (agentId) => structuredClone(rows.get(agentId)),
    findByExecution: async (id) => structuredClone([...rows.values()].find((s) => s.execution.taskId === id)),
    listByTask: async (taskId) => [...rows.values()].filter((s) => s.taskId === taskId).map((s) => structuredClone(s)),
    listUnfinalized: async (after, limit) => [...rows.values()].filter((s) => !s.finalized && (!after || s.agentId > after)).sort((a, b) => a.agentId.localeCompare(b.agentId)).slice(0, limit).map((s) => structuredClone(s)),
    update: async (start) => { rows.set(start.agentId, structuredClone(start)); },
    withLock: async (_agentId, operation) => { await operation(); },
  };
}

/** headless Agent 的执行环境假实现：受理登记排队中的执行环境，connect 模拟子 Runner 连上；命令按目标任务记录。 */
export function agentExecutionFixture() {
  const f = workspaceFixture(), starts = memoryAgentStarts();
  const environments = new Map<TaskId, EnvironmentView>(), inputs: CreateExecutionInput[] = [], releases: TaskId[] = [];
  const routed: Array<{ taskId: TaskId; command: RunnerCommand }> = [];
  const events = new Map<TaskId, Array<{ seq: number; at: string; event: RunnerEvent }>>();
  const controls = { reject: undefined as unknown };
  const parent = f.deps.environments.getEnvironment;
  f.deps.environments.getEnvironment = async (id) => (id === workspaceTask ? parent(id) : structuredClone(environments.get(id)));
  f.deps.environments.createNativeExecution = async (input) => {
    const existing = environments.get(input.id); if (existing) return structuredClone(existing);
    if (controls.reject) throw controls.reject;
    inputs.push(input);
    const env: EnvironmentView = { ...(await parent(workspaceTask))!, id: input.id, connected: false, state: 'creating', message: '已受理，正在准备此Agent的独立执行环境',
      native: { purpose: input.purpose, parentTaskId: input.parentTaskId, agentId: input.agentId, runnerId: input.runnerId, state: 'queued', profile: { name: input.profile ?? 'coding-medium', cpu: '1', memory: '2Gi', storage: '2Gi' } } };
    environments.set(input.id, env);
    return structuredClone(env);
  };
  f.deps.environments.releaseEnvironment = async (id) => {
    const env = environments.get(id); if (!env) throw notFound('执行环境', id);
    releases.push(id); env.connected = false; env.state = 'releasing'; env.native!.state = 'cleaning';
    return structuredClone(env);
  };
  const send = f.deps.runner.sendCommand;
  f.deps.runner.sendCommand = async (taskId, command) => { routed.push({ taskId, command }); return taskId === workspaceTask ? send(taskId, command) : {}; };
  f.deps.runner.listEvents = async (taskId, options) => (events.get(taskId) ?? []).filter((e) => e.seq > (options?.sinceSeq ?? 0)
    && (!options?.kinds || options.kinds.includes(e.event.kind)) && (!options?.agentId || (e.event.kind === 'agent' ? e.event.event.agentId === options.agentId : e.event.kind === 'beforeStart' ? e.event.execution.agentId === options.agentId : false)));
  const emit = (taskId: TaskId, event: RunnerEvent, at = new Date().toISOString()) => { const list = events.get(taskId) ?? []; list.push({ seq: list.length + 1, at, event }); events.set(taskId, list); };
  const connect = (id: TaskId) => { const env = environments.get(id)!; env.connected = true; env.state = 'running'; env.native!.state = 'running'; env.message = '环境已连接'; };
  const fail = (id: TaskId, reason: string) => { const env = environments.get(id)!; env.connected = false; env.state = 'releasing'; env.native = { ...env.native!, state: 'cleaning', failureReason: reason }; env.message = reason; };
  const lifecycle = new AgentExecutionLifecycle(f.deps, starts);
  return { ...f, starts, environments, inputs, releases, routed, controls, emit, connect, fail, lifecycle, api: agentUseCases(f.deps, starts, lifecycle) };
}
