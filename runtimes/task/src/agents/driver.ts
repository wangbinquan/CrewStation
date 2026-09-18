import type { AgentEvent, AgentEventType, AgentPermission, KnownAgentProtocol, LaunchSpec, McpConnection } from '@crewstation/contracts';
import type { ManagedRuntimeContext } from '@crewstation/agent-drivers';
import type { Logger } from '@crewstation/kernel';
import type { ProcessLauncher } from '../process/launcher';

/** 一次 startAgent 命令剥掉协议外壳后的启动规格。 */
export interface AgentSpec {
  agentId: string;
  /** 算力档位名（RFC-001）：平台透传，运行时不解释，只在 started 事件里回显。 */
  compute: string;
  /** RFC-006：受理时固定的档位修订，只在 started 事件里回显。 */
  profileRevision: number;
  /** RFC-006：档位修订固定的二进制、参数与模型；headless 只接受两种已知协议。 */
  launch: LaunchSpec;
  permission: AgentPermission;
  mode: 'oneshot' | 'interactive';
  initialPrompt?: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  mcp: McpConnection[];
}

/** 由 TaskRunner 提供给驱动的宿主能力：已解析的 cwd、含凭据的完整环境（绝不记录）、降权拉起器与托管上下文。 */
export interface AgentLaunchContext {
  cwd: string;
  env: Record<string, string>;
  launcher: ProcessLauncher;
  logger: Logger;
  /** 启动前 Hook 成功后的托管上下文（私有 HOME、绑定的 CLI 配置文件）；RFC-006 起每次启动都有。 */
  managed: ManagedRuntimeContext;
}

export interface AgentProcess {
  /** 交互模式下投递后续消息；oneshot 或已结束时抛 RunnerCommandError。 */
  send(text: string): Promise<void>;
  /** 终止整棵进程树并结束事件流（会补一个 `cancelled` 事件）。 */
  cancel(): Promise<void>;
  /** 归一化事件流；迭代结束即 Agent 结束。 */
  readonly events: AsyncIterable<AgentEvent>;
}

/** 驱动接口：把一种已知协议的 CLI 包装为 AgentProcess；二进制来自每次启动的 `launch.binaryPath`（RFC-006 C5）。 */
export interface AgentDriver {
  readonly protocol: KnownAgentProtocol;
  start(spec: AgentSpec, context: AgentLaunchContext): AgentProcess;
}

/** 按档位协议取驱动（RFC-006：取代按驱动名注册的表）；测试经同一接缝注入替身。 */
export interface AgentDriverFactory {
  forProtocol(protocol: KnownAgentProtocol): AgentDriver;
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
