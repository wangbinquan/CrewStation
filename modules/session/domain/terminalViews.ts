import type { RunnerCommand } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';

/** 输入控制按服务端生成的 WebSocket 视图标识绑定，客户端不能借用另一视图的租约。 */
export function terminalViewCommand(command: RunnerCommand, viewId: string): RunnerCommand {
  if (command.type === 'startAgentTerminal' || command.type === 'stopAgentTerminal') throw forbidden('请通过开发会话的 CLI 启动／结束接口操作，以保留名册和请求幂等性');
  if (command.type === 'claimTerminalControl' || command.type === 'detachTerminal' || command.type === 'terminalInput' || command.type === 'terminalResize') return { ...command, viewId };
  return command;
}
