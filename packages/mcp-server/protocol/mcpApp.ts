import { createApp } from '@crewstation/http';
import type { AppEnv } from '@crewstation/http';
import type { Hono } from 'hono';
import type { McpEndpointOptions } from './httpEndpoint';
import { createMcpRequestHandler } from './httpEndpoint';

export interface McpAppOptions<Ctx> extends McpEndpointOptions<Ctx> {
  /** 进程名，用于 /healthz 与日志。 */
  readonly name: string;
  /** 端点路径，必须与平台注入 Agent 的 CS_MCP_*_URL 一致。 */
  readonly path: string;
}

/** 端点路径以平台告知 Agent 的地址为准，避免两处各写一遍 `/mcp`。 */
export function mcpPathFrom(url: string | undefined, fallback = '/mcp'): string {
  if (!url) return fallback;
  try {
    const path = new URL(url).pathname;
    return path === '/' ? fallback : path;
  } catch {
    return fallback;
  }
}

export function createMcpApp<Ctx>(options: McpAppOptions<Ctx>): Hono<AppEnv> {
  const handle = createMcpRequestHandler(options);
  const app = createApp({ name: options.name });
  app.post(options.path, (c) => handle(c.req.raw));
  // 无状态部署不提供 GET 的服务端推流与 DELETE 的会话结束；按 JSON-RPC 形状明确回绝，客户端可据此退回逐请求模式。
  app.on(['GET', 'DELETE'], options.path, (c) =>
    c.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: '本 MCP 无状态部署：只接受 POST 的 JSON-RPC 请求' } }, 405));
  return app;
}
