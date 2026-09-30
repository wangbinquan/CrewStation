import { connectDatabase } from '@crewstation/persistence';
import { createEventsModule } from '../wiring';
import type { DeliveryProcess } from '../ports/deliveryProcesses';

/** 独立 Bun 进程持有真实 shared 准入和实际未返回回调；只由原进程验收夹具启动。 */
const url = process.env.CS_TEST_DELIVERY_DATABASE_URL,deliveryId = process.env.CS_TEST_DELIVERY_ID,source = process.env.CS_TEST_DELIVERY_PROCESS;
if (!url || !deliveryId || !source) throw new Error('Missing native delivery test input');
const processIdentity: DeliveryProcess = JSON.parse(source);
const database = connectDatabase(url,{ max: 1 });
const events = createEventsModule({ db: database.db,projects: { isAdmin: async () => true,authorize: async () => 'owner' },
  services: { resolveService: async () => undefined },endpoints: { resolve: async () => ({ baseUrl: 'http://test-receiver' }) },
  processes: { protectCurrent: async () => processIdentity,sweep: async () => undefined },
  pusher: { push: async () => { await Bun.write(Bun.stdout,'PUSH_STARTED\n'); return new Promise<never>(() => { /* parent terminates the actual original process */ }); } },
});
// 连接断开只拒绝外层请求；原进程和未返回的外部回调保持活着，等待父进程实际 SIGTERM。
setInterval(() => undefined,1000);
await events.api.deliver(deliveryId).catch(async () => { await Bun.write(Bun.stdout,'DELIVERY_FAILED\n'); return new Promise<never>(() => { /* parent owns the actual process stop */ }); });
