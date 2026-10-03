import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { resourceAccessMigrations } from '../wiring';
import { resourceAccessDeletionFixture, type ResourceAccessDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable(); let f: ResourceAccessDeletionFixture;
afterEach(async () => { await f?.db.drop(); });
describe.skipIf(!available)('资源申请原归属目录不可改写（真实 PG）', () => {
  test('从旧 0002 升级只保护原最小映射；正文、归属摘要和未知历史均保持', async () => {
    f = await resourceAccessDeletionFixture({ withoutIdentityGuard: true });
    const original = await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own);
    const before = [...await f.db.db.execute(sql`SELECT * FROM resource_access.deletion_identities ORDER BY id`)];
    const missing = newResourceId();
    await runMigrations(f.db.db, [resourceAccessMigrations]);
    expect([...await f.db.db.execute(sql`SELECT * FROM resource_access.deletion_identities ORDER BY id`)]).toEqual(before);
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own)).toEqual(original);
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(missing)).toBeUndefined();
    expect([...await f.db.db.execute(sql`SELECT body FROM resource_access.changes WHERE id=${f.ids.own}`)]).toEqual([{ body: { private: 'erase-owned-reason' } }]);
    for (const query of [sql`UPDATE resource_access.deletion_identities SET project_id=${f.other.id} WHERE id=${f.ids.own}`, sql`DELETE FROM resource_access.deletion_identities WHERE id=${f.ids.own}`, sql`TRUNCATE resource_access.deletion_identities`]) {
      await expect(Promise.resolve(f.db.db.execute(query))).rejects.toMatchObject({ cause: { message: 'resource request original identity is immutable' } });
      expect(await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.own)).toEqual(original);
    }
  });
  test('原请求的实际写入仍能追加归属，直接伪造没有原行的映射拒绝', async () => {
    f = await resourceAccessDeletionFixture();
    const id = newResourceId();
    await expect(Promise.resolve(f.db.db.execute(sql`INSERT INTO resource_access.deletion_identities VALUES (${id},${f.own.id})`))).rejects.toMatchObject({ cause: { message: 'resource request original identity requires an original request' } });
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(id)).toBeUndefined();
    await f.db.db.execute(sql`INSERT INTO resource_access.changes VALUES (${id},${f.own.id},${f.admin.userId},${newResourceId()},${id},'pending',1,'{}',now())`);
    const original = await f.resourceAccess.api.originalInfrastructureOwnership(id);
    expect(original).toMatchObject({ complete: true, id, projectIds: [f.own.id] });
    await f.db.db.execute(sql`UPDATE resource_access.changes SET body='{"private":"changed"}' WHERE id=${id}`);
    expect(await f.resourceAccess.api.originalInfrastructureOwnership(id)).toEqual(original);
    await expect(Promise.resolve(f.db.db.execute(sql`UPDATE resource_access.deletion_identities SET id=${newResourceId()} WHERE id=${id}`))).rejects.toMatchObject({ cause: { message: 'resource request original identity is immutable' } });
    expect((await f.resourceAccess.api.originalInfrastructureOwnership(f.ids.other))?.projectIds).toEqual([f.other.id]);
  });
});
