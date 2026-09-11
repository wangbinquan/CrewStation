// 能力说明 MCP 进程入口：读取配置、装配服务器定义、启动服务。资源与协议实现在 packages/mcp-server。
import { CONTRACTS_VERSION, HOST_PATTERNS, PLATFORM_ENV } from '@crewstation/contracts';
import { installShutdown, serve } from '@crewstation/http';
import { createJsonLogger } from '@crewstation/kernel';
import { capabilitiesServerDefinition, capabilityContextFor, createMcpApp, mcpPathFrom } from '@crewstation/mcp-server';

const name = 'mcp-capabilities';
const logger = createJsonLogger({ service: name });
const serviceDomain = process.env[PLATFORM_ENV.serviceDomain] ?? 'svc.cs.internal';
// 端点地址与平台注入 Agent 的那份保持一致，两处不各写一遍。
const path = mcpPathFrom(process.env.CS_MCP_CAPABILITIES_URL);
const platformApiUrl = process.env[PLATFORM_ENV.platformApiUrl]
  ?? `http://${HOST_PATTERNS.platformApi.replace('{serviceDomain}', serviceDomain)}`;
const port = Number(process.env.CS_MCP_CAPABILITIES_PORT ?? 8085);

const app = createMcpApp({
  name,
  path,
  definition: capabilitiesServerDefinition(CONTRACTS_VERSION),
  contextFor: (request) => capabilityContextFor({ platformApiUrl }, request),
});
const server = serve(app, { port });
logger.info('listening', { port: server.port, path, platformApiUrl });
installShutdown(logger, [{ name: 'server', stop: () => server.stop() }]);
