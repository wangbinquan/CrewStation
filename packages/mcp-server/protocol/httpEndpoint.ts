import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildMcpServer } from './buildServer';
import type { McpServerDefinition } from './definitions';

export interface McpEndpointOptions<Ctx> {
  readonly definition: McpServerDefinition<Ctx>;
  /** 每个请求解析一次上下文：调用方身份来自网关注入的请求头，不能跨请求复用。 */
  contextFor(request: Request): Ctx;
}

/**
 * 无状态 Streamable HTTP：每个请求新建 server 与 transport，响应读完即关。
 * 这样两个 MCP 可以多副本无粘性部署（Design §5.9），代价是不提供服务端主动推流。
 */
export function createMcpRequestHandler<Ctx>(options: McpEndpointOptions<Ctx>): (request: Request) => Promise<Response> {
  return async (request) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    const server = buildMcpServer(options.definition, options.contextFor(request));
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      const body = await response.text();
      return new Response(body.length === 0 ? null : body, { status: response.status, headers: response.headers });
    } finally {
      await server.close();
    }
  };
}
