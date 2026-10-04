import { afterEach, describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { deletionFixture } from './deletionFixture';
import { workspace } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('台账原 Pod 停止观测许可（真实 PG＋受控物理端口）', () => {
  let database: TestDatabase;
  afterEach(async () => { await database?.drop(); });
  test('只在原封闭范围、当前世代与 stop 阶段转发观测，观测不等于资源停止', async () => {
    const f = await deletionFixture(); database = f.database;
    const record = await f.module.api.owner('task-runtime').declare(workspace('original')); const confirmed = await f.plan();
    await expect(f.owner.observeTerminating(f.context('stop'))).rejects.toMatchObject({ kind: 'precondition' }); expect(f.effects).toEqual([]);
    await f.run('seal'); f.effects.length = 0; const before = await f.module.api.get(record.id);
    expect(await f.owner.observeTerminating(f.context('stop'))).toBeUndefined(); expect(f.effects).toEqual(['observe-terminating']);
    expect(await f.module.api.get(record.id)).toEqual(before);
    await expect(f.run('purge')).rejects.toThrow('未停止');
    await expect(f.owner.observeTerminating(f.context('purge'))).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.owner.observeTerminating(f.context('stop', { generation: 999 }))).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.owner.observeTerminating(f.context('stop', { confirmed: { ...confirmed, participant: 'session' } }))).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.owner.observeTerminating(f.context('stop', { confirmed: { ...confirmed, revision: jsonHash('replacement') } }))).rejects.toMatchObject({ kind: 'precondition' });
    f.revoke(); await expect(f.owner.observeTerminating(f.context('stop'))).rejects.toMatchObject({ kind: 'precondition' });
    expect(f.effects).toEqual(['observe-terminating']); expect(await f.module.api.get(record.id)).toEqual(before);
  });
  test('物理观测报错保留原台账和封闭范围，不能转成空来源或 stop 完成证明', async () => {
    const f = await deletionFixture(); database = f.database;
    const record = await f.module.api.owner('task-runtime').declare(workspace('source-down')); await f.plan(); await f.run('seal');
    const before = await f.module.api.get(record.id), observe = f.physics.observeTerminating;
    f.physics.observeTerminating = async () => { throw new Error('original pod source unavailable'); };
    await expect(f.owner.observeTerminating(f.context('stop'))).rejects.toThrow('original pod source unavailable');
    expect(await f.module.api.get(record.id)).toEqual(before); await expect(f.run('purge')).rejects.toThrow('未停止');
    f.physics.observeTerminating = observe; expect(await f.owner.observeTerminating(f.context('stop'))).toBeUndefined();
    expect(await f.module.api.get(record.id)).toEqual(before);
  });
});
