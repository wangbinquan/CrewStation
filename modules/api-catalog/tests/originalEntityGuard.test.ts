import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { apiCatalogMigrations } from '../wiring';
import { apiCatalogDeletionFixture, type ApiCatalogDeletionFixture } from './apiCatalogDeletionFixture';

const available = await testDatabaseAvailable(); let f: ApiCatalogDeletionFixture;
afterEach(async () => { await f?.db.drop(); });
describe.skipIf(!available)('API 目录的原最小归属保护（真实 PG）', () => {
  test('旧 0007 原映射和正文无损升级，普通 SQL 不能改写、删除或截断原目录', async () => {
    f = await apiCatalogDeletionFixture({ withoutOriginalGuard: true });
    const original = await f.catalog.api.originalInfrastructureOwnership(f.ids.operation);
    const before = [...await f.db.db.execute(sql`SELECT * FROM api_catalog.deletion_entities ORDER BY kind,entity_id`)];
    await runMigrations(f.db.db, [apiCatalogMigrations]);
    expect([...await f.db.db.execute(sql`SELECT * FROM api_catalog.deletion_entities ORDER BY kind,entity_id`)]).toEqual(before);
    expect(await f.catalog.api.originalInfrastructureOwnership(f.ids.operation)).toEqual(original);
    expect(await f.catalog.api.originalInfrastructureOwnership(newResourceId())).toBeUndefined();
    expect([...await f.db.db.execute(sql`SELECT document FROM api_catalog.proxies WHERE id=${f.ids.proxy}`)]).toEqual([{ document: { private: 'erase-owned' } }]);
    for (const query of [sql`UPDATE api_catalog.deletion_entities SET project_id=${f.other.id} WHERE kind='operation' AND entity_id=${f.ids.operation}`, sql`DELETE FROM api_catalog.deletion_entities WHERE kind='operation' AND entity_id=${f.ids.operation}`, sql`TRUNCATE api_catalog.deletion_entities`]) {
      await expect(Promise.resolve(f.db.db.execute(query))).rejects.toMatchObject({ cause: { message: 'API catalog original identity is immutable' } });
      expect(await f.catalog.api.originalInfrastructureOwnership(f.ids.operation)).toEqual(original);
    }
    const id = newResourceId();
    await f.db.db.execute(sql`INSERT INTO api_catalog.operations(id,proxy_id,proxy,method,path,summary,open_policy,resource_note,state,updated_at) VALUES (${id},${f.ids.proxy},'catalog-delete','GET','/new','new','default','new','active',now())`);
    expect(await f.catalog.api.originalInfrastructureOwnership(id)).toMatchObject({ complete: true, id, projectIds: [f.own.id] });
    expect((await f.catalog.api.originalInfrastructureOwnership(f.ids.otherOperation))?.projectIds).toEqual([f.other.id]);
  });
});
