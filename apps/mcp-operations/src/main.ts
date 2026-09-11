// 操作 MCP 进程入口：读取配置、装配服务器定义、启动服务。工具与协议实现在 packages/mcp-server。
import { CONTRACTS_VERSION, HOST_PATTERNS, PLATFORM_ENV, PLATFORM_PATHS } from '@crewstation/contracts';
import { installShutdown, serve } from '@crewstation/http';
import { createJsonLogger } from '@crewstation/kernel';
import { createMcpApp, mcpPathFrom, operationsContextFor, operationsServerDefinition } from '@crewstation/mcp-server';

const name = 'mcp-operations';
const logger = createJsonLogger({ service: name });
const serviceDomain = process.env[PLATFORM_ENV.serviceDomain] ?? 'svc.cs.internal';
const platformApiHost = HOST_PATTERNS.platformApi.replace('{serviceDomain}', serviceDomain);
// 端点地址与平台注入 Agent 的那份保持一致，两处不各写一遍。
const path = mcpPathFrom(process.env.CS_MCP_OPERATIONS_URL);
const platformApiUrl = process.env[PLATFORM_ENV.platformApiUrl] ?? `http://${platformApiHost}`;
const internalApiBase = process.env[PLATFORM_ENV.internalApiBase] ?? `http://${platformApiHost}${PLATFORM_PATHS.internalApiPrefix}`;
const port = Number(process.env.CS_MCP_OPERATIONS_PORT ?? 8086);

const app = createMcpApp({
  name,
  path,
  definition: operationsServerDefinition(CONTRACTS_VERSION),
  contextFor: (request) => operationsContextFor({ platformApiUrl, internalApiBase }, request),
});
const server = serve(app, { port });
logger.info('listening', { port: server.port, path, platformApiUrl, internalApiBase });
installShutdown(logger, [{ name: 'server', stop: () => server.stop() }]);
