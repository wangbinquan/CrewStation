import type { AgentEvent } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { AgentDriver, AgentProcess, AgentSpec } from './driver';
import { createAgentEventFactory } from './driver';
import { createEventQueue } from './eventQueue';

export interface CliDriverOptions {
  name: 'claude-code' | 'opencode';
  /** PATH 上的可执行文件名：`claude`／`opencode`。 */
  binary: string;
  /** 测试钩子；缺省 Bun.which。 */
  which?: (binary: string) => string | null;
}

/**
 * 两个 CLI 驱动的占位实现：只探测二进制是否存在。真实实现（argv／env 装配、stream-json 解析、会话恢复）
 * 将从 `@crewstation/agent-drivers` 接入，本运行时不提前依赖该包。占位驱动永不在 hello 中宣告可用。
 */
export function createCliDriver(options: CliDriverOptions): AgentDriver {
  const which = options.which ?? ((binary: string) => Bun.which(binary));
  return {
    name: options.name,
    available: () => false,
    start(spec: AgentSpec): AgentProcess {
      const events = createEventQueue<AgentEvent>();
      const event = createAgentEventFactory(spec.agentId);
      const path = which(options.binary);
      const error = path === null
        ? { code: 'driver_not_installed', message: `driver binary not installed: ${options.binary}` }
        : { code: 'driver_not_implemented', message: `driver ${options.name} 尚未接入本运行时（等待 @crewstation/agent-drivers）` };
      events.push(event('error', { error }));
      events.close();
      return {
        events,
        send: () => Promise.reject(new RunnerCommandError('agent_not_running', `driver ${options.name} 未启动`)),
        cancel: () => Promise.resolve(),
      };
    },
  };
}
