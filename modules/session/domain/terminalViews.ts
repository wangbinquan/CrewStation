import type { RunnerCommand, TerminalHolder } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';

/**
 * 输入控制按服务端生成的 WebSocket 视图标识绑定，客户端不能借用另一视图的租约。
 * 取得控制时的持有人同样只认连接的网关身份：浏览器自带的 `holder` 一律丢弃（2026-09-23）。
 */
export function terminalViewCommand(command: RunnerCommand, viewId: string, holder?: TerminalHolder): RunnerCommand {
  if (command.type === 'startAgentTerminal' || command.type === 'stopAgentTerminal') throw forbidden('请通过开发会话的 CLI 启动／结束接口操作，以保留名册和请求幂等性');
  if (command.type === 'claimTerminalControl') {
    const { holder: _untrusted, ...rest } = command;
    return { ...rest, viewId, ...(holder ? { holder } : {}) };
  }
  if (command.type === 'detachTerminal' || command.type === 'terminalInput' || command.type === 'terminalResize') return { ...command, viewId };
  return command;
}
