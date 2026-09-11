// mcp-capabilities 进程入口：读取配置、装配模块入口、启动服务。业务逻辑一律在 modules/*。
import { createApp, serve } from '@crewstation/http';
import { createJsonLogger } from '@crewstation/kernel';

const name = 'mcp-capabilities';
const port = Number(process.env.CS_MCP_CAPABILITIES_PORT ?? 8085);
const logger = createJsonLogger({ service: name });
const app = createApp({ name });
serve(app, { port });
logger.info('listening', { port });
