import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('actual Root data deletion source (no physical deletion claim)', () => {
  test('Root installs real data owner and Project original source; forged grants cannot seal original data', async () => {
    const tdb = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_SECRET_KEY: Buffer.alloc(32,1).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
      const root = createPlatformModule({ db: tdb.db,k8s: createFakeK8sClient(),settings,logger: noopLogger,instance: 'data-deletion-composition' });
      await runMigrations(tdb.db,root.api.migrations);
      const admin = await root.modules.identity.api.ensureUser({ externalId: 'data-admin',name: 'Admin',email: 'data@test.invalid' });
      const created = await root.modules.project.api.createProject({ userId: admin.id,isAdmin: true },{ name: '数据删除',slug: 'data-delete',kind: 'DigitalWorker',template: BUILTIN_RESOURCES.minimalTemplate });
      const target = await root.modules.project.api.deletionScope(created.id), owner = root.modules.data.api.deletionOwner;
      expect(owner).toBeDefined();
      await tdb.db.execute(sql`INSERT INTO data.object_project_policies VALUES(${created.id},'{}')`);
      const inventory = await owner!.inspect(target);
      expect(inventory.complete).toBe(true); expect(inventory.resources.find(r => r.id === 'object_project_policies')?.count).toBe(1);
      await expect(owner!.run({ operationId: newResourceId(),generation: 1,target,confirmed: inventory,phase: 'seal' })).rejects.toThrow();
      expect(await tdb.db.execute(sql`SELECT project_id FROM data.object_project_policies`)).toHaveLength(1);
      expect(await tdb.db.execute(sql`SELECT project_id FROM data.project_deletions`)).toHaveLength(0);
    } finally { await tdb.drop(); }
  },30_000);
});
