// RFC-006 C16：通用终端协议的 CLI 不经平台注入 MCP 配置，平台把两个 MCP 的地址与本次启动的会话令牌
// 交给管理员自己接入——启动前步骤里是 `{{mcp.*}}` 模板变量，CLI 进程里是 TERMINAL_MCP_ENV 环境变量。
// 两处取值同源：都从启动命令携带的 MCP 连接里按名字取地址、按会话令牌头取令牌。

import type { McpConnection } from '@crewstation/contracts';
import { IDENTITY_HEADERS, TERMINAL_MCP_ENV } from '@crewstation/contracts';

/** 平台两个 MCP 的连接名（与组合根下发的 McpConnection.name 一致）。 */
export const PLATFORM_MCP_NAMES = { capabilities: 'capabilities', operations: 'operations' } as const;

export interface PlatformMcpEndpoints {
  readonly capabilitiesUrl?: string;
  readonly operationsUrl?: string;
  /** 开发会话令牌；业务子任务的连接没有它（见 implementation-open-questions I2）。 */
  readonly token?: string;
}

/** 从启动命令的 MCP 连接里取地址与令牌；取不到的项留空，由调用方决定是否算错。 */
export function platformMcpEndpoints(connections: readonly McpConnection[]): PlatformMcpEndpoints {
  const byName = (name: string) => connections.find((c) => c.name === name);
  const capabilities = byName(PLATFORM_MCP_NAMES.capabilities), operations = byName(PLATFORM_MCP_NAMES.operations);
  const token = [capabilities, operations, ...connections].map((c) => c?.headers[IDENTITY_HEADERS.devSessionToken]).find((value) => value !== undefined && value.length > 0);
  return {
    ...(capabilities ? { capabilitiesUrl: capabilities.url } : {}),
    ...(operations ? { operationsUrl: operations.url } : {}),
    ...(token ? { token } : {}),
  };
}

/** 通用终端 CLI 进程里的平台 MCP 环境变量；没有值的键不写，避免 CLI 读到空串当成已配置。 */
export function terminalMcpEnv(connections: readonly McpConnection[]): Record<string, string> {
  return platformMcpEnv(platformMcpEndpoints(connections));
}

/** 已取出的地址与令牌 → TERMINAL_MCP_ENV 变量；启动前脚本的环境也用这一份（与 `{{mcp.*}}` 模板同源）。 */
export function platformMcpEnv(endpoints: PlatformMcpEndpoints): Record<string, string> {
  return {
    ...(endpoints.capabilitiesUrl ? { [TERMINAL_MCP_ENV.capabilitiesUrl]: endpoints.capabilitiesUrl } : {}),
    ...(endpoints.operationsUrl ? { [TERMINAL_MCP_ENV.operationsUrl]: endpoints.operationsUrl } : {}),
    ...(endpoints.token ? { [TERMINAL_MCP_ENV.token]: endpoints.token } : {}),
  };
}
