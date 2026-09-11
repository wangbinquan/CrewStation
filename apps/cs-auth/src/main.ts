// cs-auth 进程入口：读取配置、连接数据库、装配模块、启动服务。业务逻辑一律在 modules/*；迁移由 cs-api migrate 统一执行。
import { createApp, serve } from '@crewstation/http';
import { createJsonLogger } from '@crewstation/kernel';
import { connectDatabase } from '@crewstation/persistence';
import { assembleModules } from './assembly';
import { loadSettings } from './settings';

const name = 'cs-auth';
const logger = createJsonLogger({ service: name });
const settings = loadSettings();
const { db, close } = connectDatabase(settings.databaseUrl);
const assembly = assembleModules(db, settings, logger);

const app = createApp({ name });
for (const router of assembly.routers) app.route('/', router);
const server = serve(app, { port: settings.port });
logger.info('listening', { port: settings.port, routers: assembly.routers.length, provider: settings.identityProvider, userDomain: settings.userDomain });

const shutdown = async (): Promise<void> => {
  logger.info('shutting down');
  server.stop();
  await close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
