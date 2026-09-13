import { createHash } from 'node:crypto';
import type { Actor, NativeTerminalDto, NativeTerminalList, NativeTerminalRoster, ServiceId, StartNativeTerminalRequest, TaskId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, NativeTerminalRecordSchema, RunnerResultPayloads } from '@crewstation/contracts';
import { conflict, isPlatformError, newId, notFound, precondition } from '@crewstation/kernel';
import type { NativeTerminalRepository, NativeTerminalStart } from '../ports/nativeTerminals';
import { projectNativeTerminal } from '../domain/nativeTerminalProjection';
import type { DevSessionUseCaseDeps } from './dependencies';
import { nativeCompute, nativeEnvironment } from './nativeTerminalAccess';

const fingerprintOf = (input: StartNativeTerminalRequest) => createHash('sha256').update(JSON.stringify([input.compute ?? null, input.permission, input.cwd ?? null, input.cols, input.rows])).digest('hex');
const terminal = (record: NativeTerminalStart['record']) => record.lifecycle === 'ended' || record.lifecycle === 'failed';

export function nativeTerminalUseCases(deps: DevSessionUseCaseDeps, repository: NativeTerminalRepository) {
  const readRunner = async (taskId: TaskId): Promise<NativeTerminalRoster> => RunnerResultPayloads.listAgentTerminals.parse(await deps.runner.sendCommand(taskId, { id: newId('cmd'), type: 'listAgentTerminals' }));
  const reconcile = async (start: NativeTerminalStart, roster: NativeTerminalRoster | undefined, connection: NativeTerminalDto['connection']) => {
    const dto = projectNativeTerminal(start, roster, connection, deps.clock.now().toISOString());
    if (dto.lifecycle !== 'unknown') await repository.saveRecord(start.taskId, NativeTerminalRecordSchema.parse(dto));
    return dto;
  };

  const acceptedStart = async (actor: Actor, taskId: TaskId, input: StartNativeTerminalRequest, roster: NativeTerminalRoster) => {
    const previous = await repository.findRequest(taskId, actor.userId, input.clientRequestId);
    if (previous) return previous;
    const profile = await nativeCompute(deps, input.compute);
    return repository.reserve({
      taskId, createdBy: actor.userId, clientRequestId: input.clientRequestId, fingerprint: fingerprintOf(input), input,
      driver: profile.driver, model: profile.model,
      record: { agentId: newId('agt'), terminalId: newId('pty'), runnerId: roster.runnerId, compute: profile.name, permission: input.permission, revision: 0, lifecycle: 'starting', startedAt: deps.clock.now().toISOString(), cols: input.cols, rows: input.rows },
    });
  };

  return {
    async startNativeTerminal(actor: Actor, taskId: TaskId, input: StartNativeTerminalRequest): Promise<NativeTerminalDto> {
      const env = await nativeEnvironment(deps, actor, taskId, 'develop');
      if (!env.connected || env.state === 'releasing' || env.state === 'released') throw precondition('开发容器未连接或正在释放');
      const roster = await readRunner(taskId);
      const start = await acceptedStart(actor, taskId, input, roster);
      if (start.fingerprint !== fingerprintOf(input)) throw conflict('此启动请求标识已用于不同配置，请保留原请求查询结果', { clientRequestId: input.clientRequestId });
      if (terminal(start.record) || start.record.runnerId !== roster.runnerId || roster.terminals.some((r) => r.agentId === start.record.agentId)) return reconcile(start, roster, 'connected');
      try {
        const credential = await deps.credentials.issueDevSessionToken({ taskId, projectId: env.projectId, serviceId: env.serviceId as ServiceId, userId: actor.userId });
        const record = RunnerResultPayloads.startAgentTerminal.parse(await deps.runner.sendCommand(taskId, {
          id: newId('cmd'), type: 'startAgentTerminal', agentId: start.record.agentId, terminalId: start.record.terminalId,
          runnerId: start.record.runnerId, requestFingerprint: start.fingerprint, compute: start.record.compute, driver: start.driver, model: start.model,
          permission: start.record.permission, cols: start.input.cols, rows: start.input.rows, ...(start.input.cwd ? { cwd: start.input.cwd } : {}),
          mcp: deps.settings.mcp.map((m) => ({ ...m, headers: { [IDENTITY_HEADERS.devSessionToken]: credential.token } })), env: {},
        }));
        await repository.saveRecord(taskId, record);
        await deps.environments.touch(taskId);
        return projectNativeTerminal({ ...start, record }, { runnerId: roster.runnerId, terminals: [record] }, 'connected', deps.clock.now().toISOString());
      } catch (error) {
        if (isPlatformError(error) && ['pty_unavailable', 'terminal_limit', 'terminal_exists', 'native_request_conflict'].includes(String(error.details.code))) {
          const record = { ...start.record, revision: start.record.revision + 1, lifecycle: 'failed' as const, endedAt: deps.clock.now().toISOString(), reason: 'start-failed' as const, error: error.message };
          await repository.saveRecord(taskId, record);
          return { ...record, taskId, createdBy: start.createdBy, clientRequestId: start.clientRequestId, connection: 'connected' };
        }
        deps.logger.warn('native CLI start result uncertain', { taskId, agentId: start.record.agentId });
        return projectNativeTerminal(start, undefined, 'unknown', deps.clock.now().toISOString());
      }
    },
    async listNativeTerminals(actor: Actor, taskId: TaskId): Promise<NativeTerminalList> {
      const env = await nativeEnvironment(deps, actor, taskId, 'view');
      const starts = await repository.list(taskId);
      let roster: NativeTerminalRoster | undefined;
      let connection: NativeTerminalDto['connection'] = env.connected ? 'unknown' : 'disconnected';
      if (env.connected) { try { roster = await readRunner(taskId); connection = 'connected'; } catch { /* 缺失状态保持 unknown。 */ } }
      return { items: await Promise.all(starts.map((s) => reconcile(s, roster, connection))), runnerId: roster?.runnerId ?? null, connection, checkedAt: deps.clock.now().toISOString() };
    },
    async stopNativeTerminal(actor: Actor, taskId: TaskId, agentId: string): Promise<void> {
      const env = await nativeEnvironment(deps, actor, taskId, 'develop');
      const start = (await repository.list(taskId)).find((s) => s.record.agentId === agentId);
      if (!start) throw notFound('CLI', agentId);
      if (!env.connected) throw precondition('开发容器未连接，无法确认结束结果');
      const roster = await readRunner(taskId);
      const current = await reconcile(start, roster, 'connected');
      if (current.lifecycle === 'ended' || current.lifecycle === 'failed') return;
      await deps.runner.sendCommand(taskId, { id: newId('cmd'), type: 'stopAgentTerminal', agentId, runnerId: start.record.runnerId });
      await reconcile(start, await readRunner(taskId), 'connected');
    },
  };
}
