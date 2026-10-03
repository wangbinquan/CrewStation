// cs-api 进程入口：读取配置、连接数据库与集群、装配组合根、挑选本进程的入口。业务逻辑一律在 modules/*。
import { hostname } from 'node:os';
import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import { createApp, installShutdown, serve, serveStreams } from '@crewstation/http';
import { createK8sClient, loadClusterConfig } from '@crewstation/k8s';
import { createJsonLogger } from '@crewstation/kernel';
import { createPlatformModule } from '@crewstation/module-platform';
import { connectDatabase, databaseReady, runMigrations,originalReportSnapshotSession } from '@crewstation/persistence';
import { loadPlatformSettings, portFrom } from '@crewstation/settings';

const name = 'cs-api';
const logger = createJsonLogger({ service: name });
const settings = loadPlatformSettings();
const { db, client, close } = connectDatabase(settings.databaseUrl);
const k8s = createK8sClient(loadClusterConfig());
const platform = createPlatformModule({ db, runtimeReportSnapshot:originalReportSnapshotSession({client}), k8s, settings, logger, instance: `${name}-${hostname()}` });
await platform.api.storageContract.check();

if (process.argv[2] === 'migrate') {
  const applied = await runMigrations(db, platform.api.migrations, logger);
  const roles = await platform.api.initializePlatformRoles();
  logger.info('migrations done', { applied: applied.length, roles });
  await close();
  process.exit(0);
}

if (process.argv[2] === 'storage-contract-enable') {
  await platform.api.storageContract.enable(); await close(); process.exit(0);
}
const app = createApp({ name, readiness: () => databaseReady(db) });
app.get('/internal/storage-contract', (c) => c.json({ name, storageContractVersion: platform.api.storageContract.version }));
for (const router of platform.api.routers.api) app.route('/', router);
const background = platform.api.background.api;
for (const item of background) item.start();
const server = serve(app, { port: portFrom(process.env, name, 8080) });
const transferApp = createApp({ name: `${name}-objects`, readiness: () => databaseReady(db) });
for (const router of platform.api.routers.transfers) transferApp.route('/', router);
const transferServer = await serveStreams(transferApp, { port: portFrom(process.env, 'objects', 8087), maxRequestBodySize: OBJECT_STORAGE_LIMITS.objectBytes, idleTimeout: OBJECT_STORAGE_LIMITS.idleSeconds + 5 });
logger.info('listening', { port: server.port, role: 'api', routers: (platform.api.routers.api).length, background: background.length });
installShutdown(logger, [
  { name: 'background', stop: async () => { for (const item of background) await item.stop(); } },
  { name: 'server', stop: () => server.stop() },
  { name: 'object-server', stop: () => transferServer.stop() },
  { name: 'database', stop: () => close() },
]);
