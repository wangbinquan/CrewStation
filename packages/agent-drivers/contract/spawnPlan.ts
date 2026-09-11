// ← agent-workflow `runtime/types.ts` 的 SpawnPlan / AgentSpawnContext 段，裁到 CrewStation 实际用到的字段。
// 源里的 persona／business 两条装配路径（`taskMounts === undefined` 分支）与两个 @deprecated 旧上下文
// 一并合并为单一形状：CrewStation 没有对拍需求，也没有工作区边界（沙箱关闭，见 index.ts）。

import type { AgentPermission, McpConnection } from '@crewstation/contracts';

/** MCP 服务器的注入形状；CrewStation 的 McpConnection 只有 remote 一种，local 保留给将来的本地 MCP。 */
export type McpServerSpec =
  | { name: string; enabled?: boolean; type: 'local'; command: string[]; env?: Record<string, string>; timeoutMs?: number }
  | { name: string; enabled?: boolean; type: 'remote'; url: string; headers?: Record<string, string>; timeoutMs?: number };

/** 把协议里的 McpConnection（Streamable HTTP）转成注入形状。 */
export function toMcpServerSpec(connection: McpConnection): McpServerSpec {
  const headers = connection.headers;
  return {
    name: connection.name,
    enabled: true,
    type: 'remote',
    url: connection.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

/** 一次拉起的 argv ＋ env ＋ stdin 约定。源的 `stdin` 只有 ignore／pipe-once 两种，这里多一种常驻流。 */
export interface SpawnPlan {
  cmd: string[];
  env: Record<string, string>;
  /** `ignore`：不开 stdin；`prompt`：写一次即关闭；`stream`：常驻，逐帧写入（仅 Claude 交互式）。 */
  stdin: { mode: 'ignore' } | { mode: 'prompt'; data: string } | { mode: 'stream' };
}

/** 组装一次拉起需要的全部平台输入。 */
export interface AgentSpawnContext {
  agentId: string;
  /** CLI 命令头；缺省 `['claude']` ／ `['opencode']`。 */
  head?: string[];
  prompt: string;
  systemPrompt?: string;
  /** `<provider>/<model>`；Claude 侧只取最后一段（见 claudeCode/argv.ts）。 */
  model?: string;
  permission: AgentPermission;
  mcps: readonly McpServerSpec[];
  resumeSessionId?: string;
  /** 交互式常驻流（Claude 的 `--input-format stream-json`）。 */
  interactiveStream?: boolean;
  cwd: string;
  /** 本次运行的私有目录：system.md、mcp-config.json、opencode 配置目录都写在这里。 */
  runDir: string;
  /** 继承自宿主的完整环境（含模型凭据，绝不记录）。 */
  baseEnv: Record<string, string>;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
}
