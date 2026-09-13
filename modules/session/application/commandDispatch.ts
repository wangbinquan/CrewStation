import type { RunnerCommand, TaskId } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';
import type { SessionUseCaseDeps } from './dependencies';
import type { RunnerHub } from './runnerHub';
import { commandTimeout } from '../domain/commandTimeout';

/** 命令派发：本副本持有连接就直接发，否则按注册表转发到持有副本；无人持有即 TaskRunner 离线。 */
export function commandDispatch(deps: SessionUseCaseDeps, hub: RunnerHub) {
  const sendLocal = (taskId: TaskId, command: RunnerCommand): Promise<unknown> | undefined => {
    const connection = hub.connections.get(taskId);
    if (!connection) return undefined;
    return new Promise<unknown>((resolve, reject) => {
      connection.pending.add({
        id: command.id, type: command.type, sentAt: deps.clock.now().getTime(), resolve,
        ...commandTimeout(command),
        reject: (error) => reject(new PlatformError(error.code === 'timeout' ? 'unavailable' : 'precondition', error.message, { code: error.code })),
      });
      try { connection.socket.send(JSON.stringify(command)); } catch (error) { connection.pending.settle(command.id, { ok: false, code: 'send_failed', message: String(error) }); }
    });
  };

  return {
    sendCommand: async (taskId: TaskId, command: RunnerCommand): Promise<unknown> => {
      const local = sendLocal(taskId, command);
      if (local) return local;
      const owner = await deps.registry.lookup(taskId);
      if (!owner || owner.replica === deps.settings.selfAddress) throw new PlatformError('unavailable', 'TaskRunner 未连接', { taskId });
      if (deps.clock.now().getTime() - owner.lastSeenAt.getTime() > deps.settings.runnerStaleMs * 3) throw new PlatformError('unavailable', 'TaskRunner 连接已失联', { taskId, replica: owner.replica });
      return deps.forwarder.forward(owner.replica, taskId, command);
    },
    /** 只在本副本尝试；供转发端点使用，避免无限转发。 */
    sendLocalOnly: async (taskId: TaskId, command: RunnerCommand): Promise<unknown> => {
      const local = sendLocal(taskId, command);
      if (!local) throw new PlatformError('unavailable', 'TaskRunner 未连接到本副本', { taskId });
      return local;
    },
    connectionStatus: async (taskId: TaskId): Promise<{ connected: boolean; replica?: string; lastSeq?: number; drivers?: string[] }> => {
      const local = hub.connections.get(taskId);
      if (local) return { connected: true, replica: deps.settings.selfAddress, lastSeq: local.lastSeq, drivers: local.hello.capabilities.drivers };
      const owner = await deps.registry.lookup(taskId);
      return owner ? { connected: true, replica: owner.replica } : { connected: false };
    },
  };
}
