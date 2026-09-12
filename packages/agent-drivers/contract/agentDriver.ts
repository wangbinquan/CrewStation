// 驱动对外契约。与 `runtimes/task/src/agents/driver.ts` 的 AgentDriver／AgentProcess 结构一致，
// 但不能直接 import 它（技术包不依赖运行时），于是在这里重新声明；宿主的 cliDriver.ts 做适配。

import type { AgentDriver as AgentDriverName, AgentEvent, AgentPermission, McpConnection } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { ProcessHost } from './processHost';

/** 一次 startAgent 剥掉协议外壳后的启动规格（与宿主 AgentSpec 同形，去掉 driver 字段）。 */
export interface DriverAgentSpec {
  agentId: string;
  /** 算力档位名（RFC-001）：平台透传，驱动不解释，只在 started 事件里回显。 */
  compute: string;
  model: string;
  permission: AgentPermission;
  mode: 'oneshot' | 'interactive';
  initialPrompt?: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  mcp: McpConnection[];
}

export interface DriverLaunchContext {
  cwd: string;
  /** 已含模型凭据的完整子进程环境；驱动只读不记录。 */
  env: Record<string, string>;
  host: ProcessHost;
  logger: Logger;
  /** 本次 Agent 的私有运行目录；缺省 `<tmpdir>/crewstation-agents/<agentId>`。 */
  runDir?: string;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
}

export interface DriverAgentProcess {
  /** 交互模式下投递后续消息；oneshot 或已结束时抛 DriverStateError。 */
  send(text: string): Promise<void>;
  cancel(): Promise<void>;
  readonly events: AsyncIterable<AgentEvent>;
}

export interface CliAgentDriver {
  readonly name: AgentDriverName;
  /** 只有二进制真的在 PATH 上才为 true —— 它进 hello 的 capabilities.drivers。 */
  available(): boolean;
  start(spec: DriverAgentSpec, context: DriverLaunchContext): DriverAgentProcess;
}

/**
 * 驱动状态错误：宿主把 `code` 原样转成协议 `error { code }`。
 * 用独立类而不是 kernel 的 PlatformError，是因为这些 code 是 TaskRunner 协议级字符串
 * （`agent_not_interactive`／`agent_not_running`），不属于 kernel 的九种 ErrorKind。
 * 装配期的输入校验仍然用 kernel 的 `validation()`。
 */
export class DriverStateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DriverStateError';
  }
}
