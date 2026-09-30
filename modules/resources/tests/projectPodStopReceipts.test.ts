import { afterEach, describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { deletionFixture } from './deletionFixture';
import { PROJECT } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('原 Pod 停止最小持久回执（真实 PG）', () => {
  let database: TestDatabase;
  afterEach(async () => { await database?.drop(); });
  test('必须为原实例及原节点、有当期持久闭准入和 stop 许可，才保存不可替换的停止摘要', async () => {
    const f = await deletionFixture(); database = f.database;
    const key = JSON.stringify({ apiVersion: 'v1', kind: 'Pod', namespace: f.context('seal').target.namespace, name: 'original' });
    const inspect = f.physics.inspect; f.physics.inspect = async (target) => { const current = await inspect(target); return { ...current, resources: [...current.resources, { kind: 'protected:Pod', id: key, identity: JSON.stringify({ uid: 'original-pod', nodeUid: 'original-node' }), count: 1 }] }; };
    await f.plan(); const store = f.module.api.projectDeletion.podStopReceipts(f.grant);
    const receipt = { key, uid: 'original-pod', nodeUid: 'original-node', digest: jsonHash('actual-stop-proof'), observedAt: '2026-09-30T12:00:00.000Z' };
    await expect(store.save(f.context('stop'), receipt)).rejects.toMatchObject({ kind: 'precondition' });
    await f.run('seal'); await expect(store.save(f.context('seal'), receipt)).rejects.toThrow('阶段');
    await expect(store.save(f.context('stop'), { ...receipt, uid: 'replacement' })).rejects.toThrow('原确认');
    await expect(store.save(f.context('stop'), { ...receipt, nodeUid: 'replacement-node' })).rejects.toThrow('原确认');
    await store.save(f.context('stop'), receipt); await store.save(f.context('stop'), receipt);
    expect(await store.get(f.context('stop'), key, receipt.uid)).toEqual(receipt);
    await expect(store.save(f.context('stop'), { ...receipt, digest: jsonHash('changed-proof') })).rejects.toThrow('不可替换');
    await expect(store.get(f.context('stop'), key, 'replacement')).rejects.toThrow('替换');
    for (const query of [sql`UPDATE resources.deletion_stop_receipts SET original_uid = 'replacement' WHERE project_id = ${PROJECT}`, sql`DELETE FROM resources.deletion_stop_receipts WHERE project_id = ${PROJECT}`, sql`INSERT INTO resources.deletion_stop_receipts VALUES (${PROJECT},${f.operationId},'fake','fake',null,${jsonHash('fake')},now())`]) await expect(Promise.resolve(database.db.execute(query))).rejects.toMatchObject({ cause: { code: '55000' } });
    f.takeover(); await expect(store.get(f.context('stop', { generation: 1 }), key, receipt.uid)).rejects.toThrow('失效');
  });
  test('业务内容清完后仍能验证最小停止回执，重启不丢证明，旧项目不能补造新停止摘要', async () => {
    const f = await deletionFixture(); database = f.database;
    const key = JSON.stringify({ apiVersion: 'v1', kind: 'Pod', namespace: 'cs-demo', name: 'never-started' });
    f.physics.inspect = async () => ({ participant: 'resources', complete: true, revision: jsonHash('pod'), resources: [{ kind: 'protected:Pod', id: key, identity: JSON.stringify({ uid: 'original-pod', nodeUid: null }), count: 1 }], references: [], blockers: [] });
    await f.plan(); await f.run('seal'); const receipt = { key, uid: 'original-pod', nodeUid: null, digest: jsonHash('never-started-proof'), observedAt: '2026-09-30T12:00:00.000Z' };
    await f.module.api.projectDeletion.podStopReceipts(f.grant).save(f.context('stop'), receipt);
    await f.run('stop'); await f.run('purge'); await f.run('prove'); await f.run('metadata');
    const restarted = f.module.api.projectDeletion.podStopReceipts(f.grant);
    expect(await restarted.get(f.context('verify'), key, receipt.uid)).toEqual(receipt);
    expect((await f.owner.inspect(f.context('verify').target)).resources.filter((entry) => entry.kind.startsWith('metadata:')).every((entry) => entry.count === 0)).toBe(true);
    const stored = await database.db.execute<Record<string, unknown>>(sql`SELECT * FROM resources.deletion_stop_receipts WHERE project_id = ${PROJECT}`);
    expect(Object.keys(stored[0]!)).toEqual(['project_id', 'operation_id', 'object_key', 'original_uid', 'node_uid', 'proof_digest', 'observed_at']);
    await expect(restarted.save(f.context('stop'), { ...receipt, key: 'new-target' })).rejects.toThrow('原确认');
  });
});
