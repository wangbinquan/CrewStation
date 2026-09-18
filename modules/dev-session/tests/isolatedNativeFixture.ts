import type { NativeTerminalDto, NativeTerminalRecord, NativeTerminalRoster, RunnerCommand, StartNativeTerminalRequest, TaskId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { EnvironmentView } from '../ports/runtime';
import { nativeTerminalUseCases } from '../application/nativeTerminals';
import { fakeComputeCatalog } from './computeFixture';
import { memoryNativeRepository } from './nativeTerminalFixture';
import { workspaceActor, workspaceFixture, workspaceTask } from './workspaceFixture';

export function isolatedNativeFixture() {
  const f = workspaceFixture(), repository = memoryNativeRepository();
  const environments = new Map<TaskId, EnvironmentView>(), rosters = new Map<TaskId, NativeTerminalRoster>();
  const commands: Array<{ taskId: TaskId; command: RunnerCommand }> = [], allocations: TaskId[] = [], releases: TaskId[] = [], steps: string[] = [], issued: unknown[] = [];
  const controls = { reject: undefined as unknown, beforeCreate: undefined as (() => Promise<void>) | undefined, loseCreate: false, loseStart: false, noSnapshot: false, loseRelease: false,
    offline: new Set<TaskId>(), taskProfile: 'cli-small', model: 'opencode/one', ready: true };
  const parent = f.deps.environments.getEnvironment;
  f.deps.environments.getEnvironment = async (id) => id === workspaceTask ? parent(id) : environments.get(id);
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'qa-cli', protocol: 'opencode', model: controls.model, taskProfile: controls.taskProfile, isDefault: true }]);
  f.deps.credentials.issueDevSessionToken = async (binding) => { issued.push(binding); return { token: 'fixture-token', expiresAt: '2026-09-16T00:00:00Z' }; };
  f.deps.environments.createNativeExecution = async (input) => {
    await controls.beforeCreate?.();
    const existing = environments.get(input.id); if (existing) return existing;
    if (controls.reject) throw controls.reject;
    const env: EnvironmentView = { ...(await parent(workspaceTask))!, id: input.id, connected: controls.ready, state: controls.ready ? 'running' : 'creating',
      native: { purpose: input.purpose, parentTaskId: input.parentTaskId, agentId: input.agentId, terminalId: input.terminalId, runnerId: input.runnerId, state: controls.ready ? 'running' : 'queued', profile: { name: input.profile ?? 'default', cpu: '1', memory: '2Gi', storage: '2Gi' } } };
    environments.set(input.id, env); allocations.push(input.id); steps.push(`allocate:${input.id}`);
    rosters.set(input.id, { runnerId: input.runnerId, terminals: [] });
    if (controls.loseCreate) { controls.loseCreate = false; throw new Error('lost create receipt'); }
    return env;
  };
  f.deps.environments.releaseEnvironment = async (id) => {
    const env = environments.get(id); if (!env) throw notFound('execution', id);
    if (env.native!.state !== 'finished') { steps.push(`release:${id}`); releases.push(id); env.connected = false; env.state = 'released'; env.native!.state = 'finished'; }
    if (controls.loseRelease) { controls.loseRelease = false; throw new Error('lost cleanup receipt'); }
    return env;
  };
  f.deps.runner.sendCommand = async (taskId, command) => {
    commands.push({ taskId, command });
    if (controls.offline.has(taskId)) throw new Error('offline');
    const roster = rosters.get(taskId); if (!roster) throw notFound('runner', taskId);
    if (command.type === 'listAgentTerminals') return structuredClone(roster);
    if (command.type === 'startAgentTerminal') {
      const previous = roster.terminals.find((item) => item.agentId === command.agentId); if (previous) return structuredClone(previous);
      if (command.runnerId !== roster.runnerId) throw precondition('wrong runner');
      const record: NativeTerminalRecord = { agentId: command.agentId, terminalId: command.terminalId, runnerId: command.runnerId, compute: command.compute, permission: command.permission,
        lifecycle: 'running', revision: 2, cols: command.cols, rows: command.rows, startedAt: f.deps.clock.now().toISOString(),
        profileRevision: command.profileRevision, protocol: command.launch.protocol };
      roster.terminals.push(record); steps.push(`start:${taskId}`);
      if (controls.loseStart) { controls.loseStart = false; throw new Error('lost start receipt'); }
      return structuredClone(record);
    }
    if (command.type === 'stopAgentTerminal') {
      const entry = roster.terminals.find((r) => r.agentId === command.agentId); if (!entry) throw notFound('CLI', command.agentId);
      entry.lifecycle = 'ended'; entry.endedAt = f.deps.clock.now().toISOString(); entry.reason = 'stopped'; entry.revision++;
      return {};
    }
    if (command.type === 'attachTerminal') {
      if (controls.noSnapshot) throw new Error('snapshot unavailable');
      if (!roster.terminals.some((r) => r.terminalId === command.terminalId)) throw notFound('terminal', command.terminalId);
      steps.push(`snapshot:${taskId}`);
      return { terminalId: command.terminalId, runnerId: roster.runnerId, cols: 80, rows: 24, data: `final ${taskId}`, throughSeq: 12, scrollbackLimit: 500, truncated: false };
    }
    throw new Error(`unexpected ${command.type}`);
  };
  const api = nativeTerminalUseCases(f.deps, repository);
  const input = (): StartNativeTerminalRequest => ({ clientRequestId: crypto.randomUUID(), permission: 'edit', cols: 80, rows: 24 });
  const run = (terminal: NativeTerminalDto) => api.dispatchPendingNativeExecution(terminal.execution!.taskId);
  const start = async () => { const terminal = await api.startNativeTerminal(workspaceActor, workspaceTask, input()); await run(terminal); return terminal; };
  const ended = (terminal: NativeTerminalDto) => { const r = rosters.get(terminal.execution!.taskId)!.terminals[0]!; r.lifecycle = 'ended'; r.reason = 'exited'; r.exitCode = 0; r.revision++; r.endedAt = f.deps.clock.now().toISOString(); };
  return { ...f, repository, environments, rosters, controls, commands, allocations, releases, steps, issued, api, input, run, start, ended };
}
