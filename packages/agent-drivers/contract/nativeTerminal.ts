import type { AgentPermission, McpConnection } from '@crewstation/contracts';
import type { DriverLaunchSpec } from './processHost';

/** 平台解析后的原生终端规格；不是租户可传入的 CLI flags。 */
export interface NativeTerminalSpec {
  agentId: string;
  driver: 'claude-code' | 'opencode';
  compute: string;
  model: string;
  permission: AgentPermission;
  systemPrompt?: string;
  mcp: McpConnection[];
}

export interface PreparedNativeTerminal {
  /** 必须挂入 PTY；没有 headless stdin／JSON 流模式。 */
  plan: DriverLaunchSpec;
  nativeSessionId?: string;
  dispose(): void;
}
