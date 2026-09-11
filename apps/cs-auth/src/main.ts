// cs-auth 进程入口：读取配置、连接数据库与集群、装配组合根、挑选本进程的入口。业务逻辑一律在 modules/*。
import { hostname } from 'node:os';
import { createApp, installShutdown, serve } from '@crewstation/http';
import { createK8sClient, loadClusterConfig } from '@crewstation/k8s';
import { createJsonLogger } from '@crewstation/kernel';
import { createPlatformModule } from '@crewstation/module-platform';
import { connectDatabase, runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings, portFrom } from '@crewstation/settings';

const name = 'cs-auth';
const logger = createJsonLogger({ service: name });
const settings = loadPlatformSettings();
const { db, close } = connectDatabase(settings.databaseUrl);
const k8s = createK8sClient(loadClusterConfig());
const platform = createPlatformModule({ db, k8s, settings, logger, instance: `${name}-${hostname()}` });

if (process.argv[2] === 'migrate') {
  const applied = await runMigrations(db, platform.api.migrations, logger);
  logger.info('migrations done', { applied: applied.length });
  await close();
  process.exit(0);
}

const app = createApp({ name });
for (const router of platform.api.routers.auth) app.route('/', router);
const background: Array<{ start(): void; stop(): Promise<void> }> = [];
for (const item of background) item.start();
const server = serve(app, { port: portFrom(process.env, name, 8081) });
logger.info('listening', { port: server.port, role: 'auth', routers: (platform.api.routers.auth).length, background: background.length });
installShutdown(logger, [
  { name: 'background', stop: async () => { for (const item of background) await item.stop(); } },
  { name: 'server', stop: () => server.stop() },
  { name: 'database', stop: () => close() },
]);
