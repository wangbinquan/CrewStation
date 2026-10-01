import { expect, test } from 'bun:test';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import type { NativePostgresSource } from '@crewstation/module-data-control';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createPlatformModule } from '../wiring';
import { nativePostgresSource } from '../adapters/k8s/nativePostgresSource';

const available = await testDatabaseAvailable();
test.skipIf(!available)('formal root exposes the read-only original storage port, and missing independent probe configuration blocks before native SQL', async () => {
  const db = await createTestDatabase();
  const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
  const platform = createPlatformModule({ db: db.db, k8s: createFakeK8sClient(), settings, logger: noopLogger, instance: 'test.native-storage-source' });
  try {
    const source: NativePostgresSource | undefined = platform.modules.dataControl.api.nativePostgresSource;
    expect(source).toBeDefined(); let queries = 0;
    const connection = { query: async <T extends Record<string, unknown>[]>(): Promise<T> => { queries += 1; throw new Error('No native SQL is authorized without an independent observer'); }, assertHeld: async () => {} };
    await expect(source!.capture(connection)).rejects.toThrow('没有配置');
    expect(queries).toBe(0);
  } finally { await platform.modules.dataControl.observer.stop(); await platform.modules.dataControl.api.databaseReclamation?.close(); await db.drop(); }
}, 30_000);

test.skipIf(!available)('actual PostgreSQL TCP address reaches the service check without rejecting the inet text netmask', async () => {
  const db = await createTestDatabase(), native = await db.handle.client.reserve();
  const source = nativePostgresSource(createFakeK8sClient(), { namespace: 'system', service: 'postgres', adminUrl: 'postgres://private@postgres.system.svc:5432/postgres', probeRoot: '/volumes', probePort: 8095, probeToken: 's'.repeat(48) });
  try {
    const [binding] = await native<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const connection = {
      query: async <T extends Record<string, unknown>[]>(text: string): Promise<T> => native.unsafe<T>(text),
      assertHeld: async () => { expect((await native<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]?.pid).toBe(binding!.pid); },
    };
    // The live server returned inet::text with /32; the old adapter rejected it before consulting the Service.
    await expect(source.capture(connection)).rejects.toThrow('原生 PostgreSQL 服务身份不可用');
  } finally { native.release(); await db.drop(); }
}, 30_000);
