import { createHash } from 'node:crypto';
import type { Actor, NativeTerminalDto, NativeTerminalList, NativeTerminalRoster, ServiceId, StartNativeTerminalRequest, TaskId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, NativeTerminalRecordSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { conflict, isPlatformError, newId, notFound, precondition } from '@crewstation/kernel';
import type { NativeTerminalRepository, NativeTerminalStart } from '../ports/nativeTerminals';
import { projectNativeTerminal } from '../domain/nativeTerminalProjection';
import type { DevSessionUseCaseDeps } from './dependencies';
import { nativeCompute, nativeEnvironment } from './nativeTerminalAccess';
import { NativeExecutionLifecycle, nativeEnded } from './nativeExecution';
import { profileLaunchFields } from './profileLaunch';

const fingerprintOf = (input: StartNativeTerminalRequest) => createHash('sha256').update(JSON.stringify([input.compute ?? null, input.permission, input.cwd ?? null, input.cols, input.rows])).digest('hex');

class NativeTerminals {
  readonly execution: NativeExecutionLifecycle;
  constructor(private readonly deps: DevSessionUseCaseDeps, private readonly repository: NativeTerminalRepository) { this.execution = new NativeExecutionLifecycle(deps, repository); }
  private async readRunner(taskId: TaskId): Promise<NativeTerminalRoster> { return RunnerResultPayloads.listAgentTerminals.parse(await this.deps.runner.sendCommand(taskId, { id: newId('cmd'), type: 'listAgentTerminals' })); }
  private async reconcile(start: NativeTerminalStart, roster: NativeTerminalRoster | undefined, connection: NativeTerminalDto['connection']) {
    const dto = projectNativeTerminal(start, roster, connection, this.deps.clock.now().toISOString());
    if (dto.lifecycle !== 'unknown') await this.repository.saveRecord(start.taskId, NativeTerminalRecordSchema.parse(dto));
    return dto;
  }
  private async reserve(actor: Actor, taskId: TaskId, input: StartNativeTerminalRequest) {
    const profile = await nativeCompute(this.deps, input.compute);
    return this.repository.reserve({
      taskId, createdBy: actor.userId, clientRequestId: input.clientRequestId, fingerprint: fingerprintOf(input), input,
      profile: { profile: profile.name, revision: profile.revision }, execution: { taskId: newId('tsk') as TaskId, ...(profile.taskProfile ? { taskProfile: profile.taskProfile } : {}) },
      record: { agentId: newId('agt'), terminalId: newId('pty'), runnerId: crypto.randomUUID(), compute: profile.name, permission: input.permission, revision: 0, lifecycle: 'starting', startedAt: this.deps.clock.now().toISOString(), cols: input.cols, rows: input.rows, profileRevision: profile.revision, protocol: profile.protocol },
    });
  }
  async start(actor: Actor, taskId: TaskId, input: StartNativeTerminalRequest): Promise<NativeTerminalDto> {
    const env = await nativeEnvironment(this.deps, actor, taskId, 'develop');
    let start = await this.repository.findRequest(taskId, actor.userId, input.clientRequestId);
    if (!start) {
      if (!env.connected || env.state !== 'running' || env.native) throw precondition('工作区未连接或正在释放，不能新增 CLI');
      start = await this.reserve(actor, taskId, input);
    }
    if (start.fingerprint !== fingerprintOf(input)) throw conflict('此启动请求标识已用于不同配置，请保留原请求查询结果', { clientRequestId: input.clientRequestId });
    if (!start.execution) return this.legacyStart(actor, start, env);
    // HTTP 只登记；持久名册由后台串行准入，页面重试不与停止／清理竞争创建环境。
    return this.execution.read((await this.repository.findAgent(taskId, start.record.agentId))!);
  }
  private async legacyStart(actor: Actor, start: NativeTerminalStart, env: Awaited<ReturnType<typeof nativeEnvironment>>): Promise<NativeTerminalDto> {
    if (!env.connected) return this.reconcile(start, undefined, 'disconnected');
    const taskId = start.taskId, roster = await this.readRunner(taskId);
    if (nativeEnded(start.record) || start.record.runnerId !== roster.runnerId || roster.terminals.some((r) => r.agentId === start.record.agentId)) return this.reconcile(start, roster, 'connected');
    try {
      const credential = await this.deps.credentials.issueDevSessionToken({ taskId, projectId: env.projectId, serviceId: env.serviceId as ServiceId, userId: actor.userId });
      const profile = await profileLaunchFields(this.deps, start.profile, start.record.agentId);
      const record = RunnerResultPayloads.startAgentTerminal.parse(await this.deps.runner.sendCommand(taskId, {
        id: newId('cmd'), type: 'startAgentTerminal', agentId: start.record.agentId, terminalId: start.record.terminalId,
        runnerId: start.record.runnerId, requestFingerprint: start.fingerprint, ...profile,
        permission: start.record.permission, cols: start.input.cols, rows: start.input.rows, ...(start.input.cwd ? { cwd: start.input.cwd } : {}),
        mcp: this.deps.settings.mcp.map((m) => ({ ...m, headers: { [IDENTITY_HEADERS.devSessionToken]: credential.token } })), env: {},
      }));
      await this.repository.saveRecord(taskId, record);
      await this.deps.environments.touch(taskId);
      return projectNativeTerminal({ ...start, record }, { runnerId: roster.runnerId, terminals: [record] }, 'connected', this.deps.clock.now().toISOString());
    } catch (error) {
      if (isPlatformError(error) && ['pty_unavailable', 'terminal_limit', 'terminal_exists', 'native_request_conflict'].includes(String(error.details.code))) {
        const record = { ...start.record, revision: start.record.revision + 1, lifecycle: 'failed' as const, endedAt: this.deps.clock.now().toISOString(), reason: 'start-failed' as const, error: error.message };
        await this.repository.saveRecord(taskId, record);
        return { ...record, taskId, createdBy: start.createdBy, clientRequestId: start.clientRequestId, connection: 'connected' };
      }
      return projectNativeTerminal(start, undefined, 'unknown', this.deps.clock.now().toISOString());
    }
  }
  async list(actor: Actor, taskId: TaskId): Promise<NativeTerminalList> {
    const env = await nativeEnvironment(this.deps, actor, taskId, 'view'), starts = await this.repository.list(taskId);
    let roster: NativeTerminalRoster | undefined, connection: NativeTerminalDto['connection'] = env.connected ? 'unknown' : 'disconnected';
    if (env.connected && starts.some((s) => !s.execution)) { try { roster = await this.readRunner(taskId); connection = 'connected'; } catch { /* 缺失状态保持 unknown。 */ } }
    const items = await Promise.all(starts.map((s) => s.execution ? this.execution.read(s) : this.reconcile(s, roster, connection)));
    return { items, runnerId: roster?.runnerId ?? null, connection, checkedAt: this.deps.clock.now().toISOString() };
  }
  async stop(actor: Actor, taskId: TaskId, agentId: string): Promise<void> {
    const env = await nativeEnvironment(this.deps, actor, taskId, 'develop'), start = await this.repository.findAgent(taskId, agentId);
    if (!start) throw notFound('CLI', agentId);
    if (nativeEnded(start.record)) return;
    if (start.execution) { await this.repository.requestStop(taskId, agentId); void this.execution.dispatch(start.execution.taskId); return; }
    if (!env.connected) throw precondition('开发容器未连接，无法确认结束结果');
    const current = await this.reconcile(start, await this.readRunner(taskId), 'connected');
    if (current.lifecycle === 'ended' || current.lifecycle === 'failed') return;
    await this.deps.runner.sendCommand(taskId, { id: newId('cmd'), type: 'stopAgentTerminal', agentId, runnerId: start.record.runnerId });
    await this.reconcile(start, await this.readRunner(taskId), 'connected');
  }
  async snapshot(actor: Actor, taskId: TaskId, agentId: string) {
    await nativeEnvironment(this.deps, actor, taskId, 'view');
    if (!await this.repository.findAgent(taskId, agentId)) throw notFound('CLI', agentId);
    return this.repository.getSnapshot(taskId, agentId);
  }
}

export function nativeTerminalUseCases(deps: DevSessionUseCaseDeps, repository: NativeTerminalRepository) {
  const cases = new NativeTerminals(deps, repository);
  return { startNativeTerminal: cases.start.bind(cases), listNativeTerminals: cases.list.bind(cases), stopNativeTerminal: cases.stop.bind(cases), getNativeTerminalSnapshot: cases.snapshot.bind(cases),
    dispatchPendingNativeExecution: cases.execution.dispatch.bind(cases.execution), reconcileNativeExecutions: cases.execution.sweep.bind(cases.execution) };
}
