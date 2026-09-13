import type { NativeTerminalRecord, RunnerCommand, StartNativeTerminalRequest } from '@crewstation/contracts';
import type { NativeTerminalRepository, NativeTerminalStart } from '../ports/nativeTerminals';
import { nativeTerminalUseCases } from '../application/nativeTerminals';
import { workspaceFixture } from './workspaceFixture';

export function memoryNativeRepository(): NativeTerminalRepository {
  const records: NativeTerminalStart[] = [];
  return {
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
      if (entry && entry.record.revision < record.revision) entry.record = record;
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
  return { ...base, repository, current, calls, input, api: nativeTerminalUseCases(base.deps, repository) };
}
