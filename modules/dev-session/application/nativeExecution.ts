import type { NativeTerminalDto, NativeTerminalRecord, NativeTerminalRoster, ServiceId, TaskId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, RunnerResultPayloads } from '@crewstation/contracts';
import { isPlatformError, newId } from '@crewstation/kernel';
import type { NativeTerminalRepository, NativeTerminalStart } from '../ports/nativeTerminals';
import type { EnvironmentView } from '../ports/runtime';
import type { DevSessionUseCaseDeps } from './dependencies';
import { profileLaunchFields } from './profileLaunch';

export const nativeEnded = (record: Pick<NativeTerminalRecord, 'lifecycle'>) => record.lifecycle === 'ended' || record.lifecycle === 'failed';
const rejected = (error: unknown) => isPlatformError(error) && ['precondition', 'validation', 'quota_exceeded', 'not_found', 'conflict'].includes(error.kind);

/** 独立执行只派发已经持久受理的身份；重试沿用同一 Runner 与 CLI，结束后绝不重启。 */
export class NativeExecutionLifecycle {
  constructor(private readonly deps: DevSessionUseCaseDeps, private readonly repo: NativeTerminalRepository) {}
  private readonly active = new Map<TaskId, Promise<void>>();
  private after: string | undefined;
  private sweeping = false;
  private async finishRecord(start: NativeTerminalStart, reason: NativeTerminalRecord['reason'], error?: string) {
    if (nativeEnded(start.record)) return start.record;
    let record: NativeTerminalRecord = { ...start.record, revision: start.record.revision + 1, lifecycle: error ? 'failed' : 'ended', endedAt: this.deps.clock.now().toISOString(), reason, ...(error ? { error } : {}) };
    record = { ...record, computeName: start.record.computeName };
          await this.repo.saveRecord(start.taskId, record);
    return record;
  }
  private async admit(start: NativeTerminalStart): Promise<EnvironmentView | undefined> {
    try {
      return await this.deps.environments.createNativeExecution({ id: start.execution!.taskId, parentTaskId: start.taskId, purpose: 'cli', createdBy: start.createdBy, agentId: start.record.agentId,
        terminalId: start.record.terminalId, runnerId: start.record.runnerId, fingerprint: start.fingerprint, ...(start.execution!.taskProfile ? { profile: start.execution!.taskProfile } : {}),
        ...(start.execution!.image ? { image: start.execution!.image } : {}), ...(start.profile ? { computeProfile: { profileId: start.profile.profileId, revision: start.profile.revision } } : {}) });
    } catch (error) {
      if (!isPlatformError(error) || !rejected(error)) throw error;
      await this.finishRecord(start, 'start-failed', error.message);
      return undefined;
    }
  }
  private async roster(taskId: TaskId): Promise<NativeTerminalRoster> { return RunnerResultPayloads.listAgentTerminals.parse(await this.deps.runner.sendCommand(taskId, { id: newId('cmd'), type: 'listAgentTerminals' })); }
  async read(start: NativeTerminalStart): Promise<NativeTerminalDto> {
    const env = await this.deps.environments.getEnvironment(start.execution!.taskId);
    let record = start.record, connection: NativeTerminalDto['connection'] = env?.connected ? 'unknown' : 'disconnected';
    if (!nativeEnded(record) && (!env || !['cleaning', 'finished'].includes(env.native?.state ?? ''))) {
      if (env?.connected) {
        try {
          const current = await this.roster(env.id);
          connection = 'connected';
          if (current.runnerId !== record.runnerId) record = await this.finishRecord(start, 'runner-restarted');
          else record = current.terminals.find((r) => r.agentId === record.agentId && r.terminalId === record.terminalId && r.runnerId === record.runnerId) ?? record;
          record = { ...record, computeName: start.record.computeName };
          await this.repo.saveRecord(start.taskId, record);
        } catch { /* 单个 Runner 不响应不推断进程结束。 */ }
      }
    } else if (!nativeEnded(record) && env) record = await this.finishRecord(start, env.native?.failureReason ? 'environment-failed' : 'stopped', env.native?.failureReason);
    const lifecycle = nativeEnded(record) || record.lifecycle === 'starting' ? record.lifecycle : connection === 'connected' ? record.lifecycle : 'unknown';
    return { ...record, lifecycle, taskId: start.taskId, createdBy: start.createdBy, clientRequestId: start.clientRequestId, connection,
      execution: { taskId: start.execution!.taskId, state: env?.native?.state ?? (nativeEnded(record) ? 'finished' : 'queued'), profile: env?.native?.profile, message: start.execution!.stopRequested && !nativeEnded(record) ? '正在结束此 CLI' : env?.message },
      ...(nativeEnded(record) ? { finalScreen: start.execution!.screen ?? 'pending' } : {}) };
  }
  private async startCommand(start: NativeTerminalStart, env: EnvironmentView) {
    const credential = await this.deps.credentials.issueDevSessionToken({ taskId: start.taskId, projectId: env.projectId, serviceId: env.serviceId as ServiceId, userId: start.createdBy });
    // 受理时固定的档位修订：后台重试与迟到派发都用它，不重新解析“当前最新”（RFC-006）。
    const profile = await profileLaunchFields(this.deps, start.profile, start.record.agentId);
    let record = RunnerResultPayloads.startAgentTerminal.parse(await this.deps.runner.sendCommand(env.id, {
      id: newId('cmd'), type: 'startAgentTerminal', agentId: start.record.agentId, terminalId: start.record.terminalId, runnerId: start.record.runnerId,
      requestFingerprint: start.fingerprint, ...profile, permission: start.record.permission,
      cols: start.input.cols, rows: start.input.rows, ...(start.input.cwd ? { cwd: start.input.cwd } : {}),
      mcp: this.deps.settings.mcp.map((m) => ({ ...m, headers: { [IDENTITY_HEADERS.devSessionToken]: credential.token } })), env: {},
    }));
    record = { ...record, computeName: start.record.computeName };
          await this.repo.saveRecord(start.taskId, record);
    await this.deps.environments.touch(start.taskId);
  }
  private async cleanup(start: NativeTerminalStart, env?: EnvironmentView) {
    if (!start.execution!.screen) {
      if (env?.connected && !['cleaning', 'finished'].includes(env.native?.state ?? '')) {
        try {
          const snapshot = RunnerResultPayloads.attachTerminal.parse(await this.deps.runner.sendCommand(env.id, { id: newId('cmd'), type: 'attachTerminal', terminalId: start.record.terminalId, runnerId: start.record.runnerId }));
          if (snapshot.terminalId !== start.record.terminalId || snapshot.runnerId !== start.record.runnerId) throw new Error('CLI 末屏身份不匹配');
          await this.repo.saveSnapshot(start.taskId, start.record.agentId, { status: 'available', snapshot });
        } catch {
          if (this.deps.clock.now().getTime() - Date.parse(start.record.endedAt ?? start.record.startedAt) < 30_000) return;
          await this.repo.saveSnapshot(start.taskId, start.record.agentId, { status: 'unavailable' });
        }
      } else await this.repo.saveSnapshot(start.taskId, start.record.agentId, { status: 'unavailable' });
    }
    // 先提交末屏，再把清理意图交给 task-runtime；清理请求回执丢失由本名册继续重试。
    if ((await this.repo.getSnapshot(start.taskId, start.record.agentId)).status === 'pending') return;
    if (env) await this.deps.environments.releaseEnvironment(env.id, 'user');
    await this.repo.finalize(start.taskId, start.record.agentId);
  }
  private async tick(executionId: TaskId) {
    let start = await this.repo.findExecution(executionId);
    if (!start?.execution || start.execution.finalized) return;
    if (start.execution.previousTaskId && !start.execution.stopRequested) { const old = await this.deps.environments.getEnvironment(start.execution.previousTaskId); if (old && old.native?.state !== 'finished') return; }
    let env = await this.deps.environments.getEnvironment(executionId);
    if (!env && !nativeEnded(start.record)) {
      if (start.execution.stopRequested) await this.finishRecord(start, 'stopped');
      else env = await this.admit(start);
    }
    start = (await this.repo.findExecution(executionId))!;
    if (nativeEnded(start.record)) { await this.cleanup(start, env); return; }
    if (!env) return;
    const observed = await this.read(start);
    start = (await this.repo.findExecution(executionId))!;
    if (nativeEnded(start.record)) { await this.cleanup(start, env); return; }
    if (start.execution!.stopRequested) {
      if (observed.connection === 'connected') {
        try { await this.deps.runner.sendCommand(executionId, { id: newId('cmd'), type: 'stopAgentTerminal', agentId: start.record.agentId, runnerId: start.record.runnerId }); }
        catch { /* 未启动或失联仍执行用户已请求的独立容器回收。 */ }
      }
      // 明确停止也能取消调度等待；持久清理只影响本次执行。
      await this.finishRecord(start, 'stopped');
      await this.cleanup((await this.repo.findExecution(executionId))!, env);
    } else if (observed.connection === 'connected' && start.record.lifecycle === 'starting') {
      try { await this.startCommand(start, env); }
      catch (error) {
        if (isPlatformError(error) && ['pty_unavailable', 'terminal_limit', 'terminal_exists', 'native_request_conflict'].includes(String(error.details.code))) await this.finishRecord(start, 'start-failed', error.message);
        else throw error;
      }
    }
  }
  dispatch(id: TaskId): Promise<void> {
    const current = this.active.get(id); if (current) return current;
    if (this.active.size >= 2) return Promise.resolve();
    const operation = this.repo.withExecutionLock(id, () => this.tick(id)).catch(() => { this.deps.logger.warn('native execution will retry', { executionTaskId: id }); }).finally(() => { this.active.delete(id); });
    this.active.set(id, operation); return operation;
  }
  async sweep() {
      if (this.sweeping) return;
      this.sweeping = true;
      try {
        const starts = await this.repo.listExecutions(this.after, 32);
        this.after = starts.length === 32 ? starts.at(-1)!.record.agentId : undefined;
        for (let i = 0; i < starts.length; i += 2) await Promise.all(starts.slice(i, i + 2).map((start) => this.dispatch(start.execution!.taskId)));
      } finally { this.sweeping = false; }
  }
}
