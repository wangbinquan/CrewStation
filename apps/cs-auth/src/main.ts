// cs-auth 进程入口：读取配置、连接数据库与集群、装配组合根、挑选本进程的入口。业务逻辑一律在 modules/*。
import { hostname } from 'node:os';
import { createApp, installShutdown, serve } from '@crewstation/http';
import { createK8sClient, loadClusterConfig } from '@crewstation/k8s';
import { createJsonLogger } from '@crewstation/kernel';
import { createPlatformModule } from '@crewstation/module-platform';
import { connectDatabase, databaseReady, runMigrations } from '@crewstation/persistence';
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

/**
 * 非交互的引导：与浏览器向导共用同一个事务用例（RFC-005 §8）。
 * 安装脚本用它播种首位管理员，本机验收与 CLI 因此不需要有人去点浏览器；
 * 已经引导过的库上它会明确失败，不会悄悄改掉现有管理员。
 */
if (process.argv[2] === 'bootstrap-admin') {
  const flag = (name: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index > 0 ? process.argv[index + 1] : undefined;
  };
  try {
    const admin = await platform.api.bootstrapAdmin({
      token: flag('token') ?? settings.bootstrapToken ?? '',
      username: flag('username') ?? '',
      displayName: flag('display-name') ?? flag('username') ?? '',
      email: flag('email') ?? '',
      password: flag('password') ?? '',
      confirmPassword: flag('password') ?? '',
    });
    logger.info('bootstrap admin created', { userId: admin.id, username: flag('username') });
    await close();
    process.exit(0);
  } catch (error) {
    logger.error('bootstrap admin failed', { reason: error instanceof Error ? error.message : String(error) });
    await close();
    process.exit(1);
  }
}

const app = createApp({ name, readiness: () => databaseReady(db) });
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
