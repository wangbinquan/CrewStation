import { createHash } from 'node:crypto';
import type { NativeTerminalRecord, NativeTerminalSnapshotDto, RunnerCommand, StartNativeTerminalRequest } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import type { NativeTerminalRepository, NativeTerminalStart } from '../ports/nativeTerminals';
import { nativeTerminalUseCases } from '../application/nativeTerminals';
import { workspaceFixture } from './workspaceFixture';

export function memoryNativeRepository(): NativeTerminalRepository {
  const records: NativeTerminalStart[] = [];
  const snapshots = new Map<string, NativeTerminalSnapshotDto>();
  const locks = new Map<string, Promise<void>>();
  return {
    async withExecutionLock(id, run) { const result = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(run); locks.set(id, result); try { await result; } finally { if (locks.get(id) === result) locks.delete(id); } },
    findAgent: async (task, agent) => records.find((r) => r.taskId === task && r.record.agentId === agent),
    findExecution: async (task) => records.find((r) => r.execution?.taskId === task),
    listExecutions: async (after, limit = 32) => records.filter((r) => r.execution && !r.execution.finalized && (!after || r.record.agentId > after)).sort((a, b) => a.record.agentId.localeCompare(b.record.agentId)).slice(0, limit),
    async requestStop(task, agent) { const r = records.find((r) => r.taskId === task && r.record.agentId === agent); if (r?.execution) r.execution.stopRequested = true; },
    async saveSnapshot(task, agent, result) {
      const r = records.find((r) => r.taskId === task && r.record.agentId === agent);
      if (r?.execution && !r.execution.screen && result.status !== 'pending') { r.execution.screen = result.status; snapshots.set(agent, result); }
    },
    getSnapshot: async (_task, agent) => snapshots.get(agent) ?? { status: 'pending' },
    async finalize(task, agent) { const r = records.find((r) => r.taskId === task && r.record.agentId === agent); if (r?.execution?.screen) r.execution.finalized = true; },
    findRequest: async (task, user, request) => records.find((r) => r.taskId === task && r.createdBy === user && r.clientRequestId === request),
    async reserve(input) {
      const existing = records.find((r) => r.taskId === input.taskId && r.createdBy === input.createdBy && r.clientRequestId === input.clientRequestId);
      if (existing) return existing;
      records.push(input);
      return input;
    },
    list: async (task) => records.filter((r) => r.taskId === task),
    async saveRecord(task, record) {
      const entry = records.find((r) => r.taskId === task && r.record.agentId === record.agentId);
      if (entry && !['ended', 'failed'].includes(entry.record.lifecycle) && entry.record.revision < record.revision) entry.record = record;
    },
  };
}

export function nativeFixture() {
  const base = workspaceFixture();
  const repository = memoryNativeRepository();
  const current = { runnerId: crypto.randomUUID(), terminals: [] as NativeTerminalRecord[], loseStartResult: false, offline: false, driver: 'claude-code' as 'claude-code' | 'stub', model: 'anthropic/model' };
  const calls: RunnerCommand[] = [];
  base.deps.compute.resolve = async (name) => ({ name, driver: current.driver, model: current.model });
  base.deps.runner.sendCommand = async (_task, c) => {
    calls.push(c);
    if (current.offline) throw new Error('offline');
    if (c.type === 'listAgentTerminals') return { runnerId: current.runnerId, terminals: current.terminals };
    if (c.type === 'stopAgentTerminal') {
      const entry = current.terminals.find((r) => r.agentId === c.agentId)!;
      entry.lifecycle = 'ended'; entry.reason = 'stopped'; entry.revision++;
      return {};
    }
    if (c.type !== 'startAgentTerminal') throw new Error(`unexpected ${c.type}`);
    const record: NativeTerminalRecord = { agentId: c.agentId, terminalId: c.terminalId, runnerId: c.runnerId, compute: c.compute, permission: c.permission, revision: 2, lifecycle: 'running', startedAt: base.deps.clock.now().toISOString(), cols: c.cols, rows: c.rows };
    current.terminals.push(record);
    if (current.loseStartResult) throw new Error('response lost after spawn');
    return record;
  };
  const input = (): StartNativeTerminalRequest => ({ clientRequestId: crypto.randomUUID(), permission: 'edit', cols: 80, rows: 24 });
  const api = nativeTerminalUseCases(base.deps, repository);
  // 此夹具代表升级前已受理的旧父 Runner 名册；新执行路径使用 isolatedNativeFixture。
  const startNativeTerminal: typeof api.startNativeTerminal = async (actor, taskId, input) => {
    if (current.driver !== 'stub' && !await repository.findRequest(taskId, actor.userId, input.clientRequestId)) await repository.reserve({
      taskId, createdBy: actor.userId, clientRequestId: input.clientRequestId, fingerprint: createHash('sha256').update(JSON.stringify([input.compute ?? null, input.permission, input.cwd ?? null, input.cols, input.rows])).digest('hex'),
      input, driver: current.driver, model: current.model,
      record: { agentId: newId('agt'), terminalId: newId('pty'), runnerId: current.runnerId, compute: input.compute ?? 'balanced', permission: input.permission, revision: 0, lifecycle: 'starting', startedAt: base.deps.clock.now().toISOString(), cols: input.cols, rows: input.rows },
    });
    return api.startNativeTerminal(actor, taskId, input);
  };
  return { ...base, repository, current, calls, input, api: { ...api, startNativeTerminal } };
}
