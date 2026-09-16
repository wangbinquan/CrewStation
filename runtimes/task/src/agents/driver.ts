import type { AgentDriver as AgentDriverName, AgentEvent, AgentEventType, AgentPermission, McpConnection, RuntimeRevisionRef } from '@crewstation/contracts';
import type { ManagedRuntimeContext } from '@crewstation/agent-drivers';
import type { Logger } from '@crewstation/kernel';
import type { ProcessLauncher } from '../process/launcher';

/** 一次 startAgent 命令剥掉协议外壳后的启动规格。 */
export interface AgentSpec {
  agentId: string;
  /** 算力档位名（RFC-001）：平台透传，运行时不解释，只在 started 事件里回显。 */
  compute: string;
  driver: AgentDriverName;
  model: string;
  permission: AgentPermission;
  mode: 'oneshot' | 'interactive';
  initialPrompt?: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  mcp: McpConnection[];
  /** RFC-004：固定的运行环境版本，只在 started 事件里回显。 */
  runtime?: RuntimeRevisionRef;
}

/** 由 TaskRunner 提供给驱动的宿主能力：已解析的 cwd、含凭据的完整环境（绝不记录）、降权拉起器。 */
export interface AgentLaunchContext {
  cwd: string;
  env: Record<string, string>;
  launcher: ProcessLauncher;
  logger: Logger;
  /** RFC-004：启动前 Hook 成功后的托管上下文（私有 HOME、绑定的 CLI 配置文件）。 */
  managed?: ManagedRuntimeContext;
}

export interface AgentProcess {
  /** 交互模式下投递后续消息；oneshot 或已结束时抛 RunnerCommandError。 */
  send(text: string): Promise<void>;
  /** 终止整棵进程树并结束事件流（会补一个 `cancelled` 事件）。 */
  cancel(): Promise<void>;
  /** 归一化事件流；迭代结束即 Agent 结束。 */
  readonly events: AsyncIterable<AgentEvent>;
}

/**
 * 驱动接口：把一种 CLI（或 stub）包装为 AgentProcess。真实的 claude-code／opencode 实现将来自
 * `@crewstation/agent-drivers`（自 agent-workflow 复制），通过 registry 接入；本运行时只定义扩展点。
 */
export interface AgentDriver {
  readonly name: AgentDriverName;
  /** 是否可在本容器内真正运行；决定 hello 的 capabilities.drivers。 */
  available(): boolean;
  start(spec: AgentSpec, context: AgentLaunchContext): AgentProcess;
}

export type AgentEventFields = Partial<Omit<AgentEvent, 'agentId' | 'seq' | 'at' | 'type'>>;

/** 为单个 Agent 生成带递增 seq 与时间戳的事件。 */
export function createAgentEventFactory(agentId: string): (type: AgentEventType, fields?: AgentEventFields) => AgentEvent {
  let seq = 0;
  return (type, fields = {}) => {
    seq += 1;
    return { agentId, seq, at: new Date().toISOString(), type, ...fields };
  };
}
