import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerDefinition } from './definitions';
import { runTool } from './toolFailure';

/** 把与传输无关的定义注册进一台 SDK 服务器；每个请求一台（无状态，多副本无需共享会话）。 */
export function buildMcpServer<Ctx>(definition: McpServerDefinition<Ctx>, ctx: Ctx): McpServer {
  // 只声明真的有内容的能力：能力说明 MCP 没有工具，声明了会让 Agent 白问一次 tools/list。
  const server = new McpServer(
    { name: definition.name, version: definition.version },
    {
      capabilities: {
        ...(definition.resources.length > 0 ? { resources: {} } : {}),
        ...(definition.tools.length > 0 ? { tools: {} } : {}),
      },
      instructions: definition.instructions,
    },
  );
  for (const resource of definition.resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      { title: resource.title, description: resource.description, mimeType: resource.mimeType },
      async (uri) => {
        const body = await resource.read(ctx);
        return { contents: [{ uri: uri.href, mimeType: body.mimeType, text: body.text }] };
      },
    );
  }
  for (const tool of definition.tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.shape },
      async (args: unknown) => runTool(() => tool.invoke(args, ctx)),
    );
  }
  return server;
}
