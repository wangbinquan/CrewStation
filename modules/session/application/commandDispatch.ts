import type { RunnerCommand, RunnerHello, TaskId } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';
import type { SessionUseCaseDeps } from './dependencies';
import type { RunnerHub } from './runnerHub';
import { commandTimeout } from '../domain/commandTimeout';
import { assertLaunchSupported } from '../domain/runtimeNegotiation';

/** RFC-016 新增的三条命令，需要 Runner 宣告 `previewControl`。 */
const PREVIEW_CONTROL_COMMANDS: ReadonlySet<RunnerCommand['type']> = new Set(['startPreview', 'stopPreview', 'previewLogs']);

/** 命令派发：本副本持有连接就直接发，否则按注册表转发到持有副本；无人持有即 TaskRunner 离线。 */
export function commandDispatch(deps: Pick<SessionUseCaseDeps, 'registry' | 'forwarder' | 'settings' | 'clock'>, hub: Pick<RunnerHub, 'connections'>) {
  const sendLocal = (taskId: TaskId, command: RunnerCommand): Promise<unknown> | undefined => {
    const connection = hub.connections.get(taskId);
    if (!connection) return undefined;
    // 在写入旧 Runner 的 socket 前协商，未知命令不得干扰正在运行的 CLI。
    if (command.type === 'invokeApi' && connection.hello.capabilities.apiInvocations !== 1) throw new PlatformError('precondition', '当前开发容器不支持 API 试调；请保存工作并在容器更新后重新开启会话', { code: 'api_invocations_unavailable' });
    // RFC-016：旧镜像的 Runner 不懂这三条；previewStatus 与 restartPreview 不在此列，存量会话照常可用。
    if (PREVIEW_CONTROL_COMMANDS.has(command.type) && connection.hello.capabilities.previewControl !== 1) {
      throw new PlatformError('precondition', '当前开发容器不支持停止／启动预览与读取预览输出；请保存工作并在容器更新后重建会话', { code: 'preview_control_unavailable' });
    }
    assertLaunchSupported(command, connection.hello.capabilities);
    return (async () => {
      const wire = connection.legacy ? await connection.legacy.outgoing(command) : command;
      return new Promise<unknown>((resolve, reject) => {
      connection.pending.add({
        id: command.id, type: command.type, sentAt: deps.clock.now().getTime(), resolve,
        ...commandTimeout(command),
        reject: (error) => reject(new PlatformError(error.code === 'timeout' ? 'unavailable' : 'precondition', error.message, { code: error.code })),
      });
      try { connection.socket.send(JSON.stringify(wire)); } catch (error) { connection.pending.settle(command.id, { ok: false, code: 'send_failed', message: String(error) }); }
      });
    })();
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
    connectionStatus: async (taskId: TaskId): Promise<{ connected: boolean; replica?: string; lastSeq?: number; protocols?: string[]; capabilities?: RunnerHello['capabilities'] }> => {
      const local = hub.connections.get(taskId);
      if (local) return { connected: true, replica: deps.settings.selfAddress, lastSeq: local.lastSeq, protocols: local.hello.capabilities.protocols, capabilities: local.hello.capabilities };
      const owner = await deps.registry.lookup(taskId);
      return owner ? { connected: true, replica: owner.replica } : { connected: false };
    },
  };
}
