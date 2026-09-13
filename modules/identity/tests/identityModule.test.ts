import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createIdentityModule, identityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;

beforeAll(async () => { if (available) tdb = await createTestDatabase([identityMigrations]); });
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('identity module', () => {
  test('首个登录者成为管理员，配置邮箱亦为管理员，其余不是', async () => {
    const { api } = createIdentityModule({ db: tdb.db, settings: { adminEmails: ['boss@example.com'] } });
    const first = await api.ensureUser({ externalId: 'demo:alice', name: 'Alice', email: 'alice@example.com' });
    const boss = await api.ensureUser({ externalId: 'demo:boss', name: 'Boss', email: 'Boss@Example.com' });
    const bob = await api.ensureUser({ externalId: 'demo:bob', name: 'Bob', email: 'bob@example.com' });
    expect([first.isAdmin, boss.isAdmin, bob.isAdmin]).toEqual([true, true, false]);
    expect((await api.ensureUser({ externalId: 'demo:bob', name: 'Robert', email: 'bob@example.com' })).name).toBe('Robert');
    expect(await api.isAdmin(bob.id)).toBe(false);
    expect((await api.setAdmin(bob.id, true)).isAdmin).toBe(true);
    expect((await api.findByEmail('BOB@example.com'))?.id).toBe(bob.id);
    expect((await api.listUsers()).length).toBe(3);
  });
  test('重复邮箱不能被精确查询任意选中；用户 ID 仍然稳定定位', async () => {
    const { api } = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
    const first = await api.ensureUser({ externalId: 'duplicate:one', name: 'One', email: 'duplicate@example.com' });
    await api.ensureUser({ externalId: 'duplicate:two', name: 'Two', email: 'DUPLICATE@example.com' });
    // 成员候选只返回唯一匹配，不能把同邮箱的另一个身份悄悄选入指定名单。
    expect(await api.findByEmail('duplicate@example.com')).toBeUndefined();
    expect(await api.getUser(first.id)).toMatchObject({ name: 'One' });
  });
});
