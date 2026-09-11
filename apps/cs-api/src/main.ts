// cs-api 进程入口：读取配置、连接数据库、装配模块、启动服务。业务逻辑一律在 modules/*。
import { eventbusMigrations } from '@crewstation/eventbus';
import { createApp, serve } from '@crewstation/http';
import { createK8sClient, loadClusterConfig } from '@crewstation/k8s';
import { createJsonLogger } from '@crewstation/kernel';
import { connectDatabase, runMigrations } from '@crewstation/persistence';
import { queueMigrations } from '@crewstation/queue';
import { assembleModules } from './assembly';
import { loadSettings } from './settings';

const name = 'cs-api';
const logger = createJsonLogger({ service: name });
const settings = loadSettings();
const { db, close } = connectDatabase(settings.databaseUrl);
const k8s = createK8sClient(loadClusterConfig());
const assembly = assembleModules(db, k8s, settings, logger);
const command = process.argv[2] ?? 'serve';

if (command === 'migrate') {
  const applied = await runMigrations(db, [queueMigrations, eventbusMigrations, ...assembly.migrations], logger);
  logger.info('migrations done', { applied: applied.length });
  await close();
  process.exit(0);
}

const app = createApp({ name });
for (const router of assembly.routers) app.route('/', router);
const server = serve(app, { port: settings.port });
logger.info('listening', { port: settings.port, routers: assembly.routers.length });

const shutdown = async (): Promise<void> => {
  logger.info('shutting down');
  server.stop();
  await close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
