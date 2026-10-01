import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createResourcesModule } from '..';
import { deletionFixture } from './deletionFixture';
import { OTHER_PROJECT, PROJECT } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('原生 PostgreSQL 的完整保留台账与身份缺口（真实 PG）', () => {
  let database: TestDatabase;
  afterEach(async () => { await database?.drop(); });
  test('公开端口完整读取超过列表上限的停止、失败与在途记录，并排除其他项目', async () => {
    const fixture = await deletionFixture(); database = fixture.database;
    const seed = await fixture.module.api.owner('data').declare({ kind: 'data-binding', ref: 'history-seed', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: 'cs_hist_seed' }] } });
    const id = newResourceId();
    await database.db.execute(sql`INSERT INTO resources.records
      SELECT left(${id},24)||lpad(n::text,12,'0'),kind,project_id,owner_module,'history-'||n,parent_id,purpose,
        CASE WHEN n % 2 = 0 THEN 'absent' ELSE 'present' END,
        jsonb_build_object('children',jsonb_build_array(jsonb_build_object('kind','PostgresRole','name','cs_hist_'||n))),
        generation,observed_generation,release_reason,status,CASE WHEN n % 3 = 0 THEN 'failed' WHEN n % 2 = 0 THEN 'stopped' ELSE 'pending' END,
        phase_since,idle_since,retain_until,version,created_at,updated_at,compacted_at
      FROM resources.records CROSS JOIN generate_series(1,2002) AS n WHERE id=${seed.id}`);
    await fixture.module.api.owner('data').declare({ kind: 'database', ref: 'foreign', projectId: OTHER_PROJECT, spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_foreign' }] } });
    expect(await fixture.module.api.list({ projectId: PROJECT, kind: 'data-binding', includeStopped: true })).toHaveLength(2000);
    const report = await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT);
    expect(report.retainedRecordsComplete).toBe(true);
    expect(report.records).toHaveLength(2003);
    expect(report.records.some((row) => row.phase === 'stopped')).toBe(true);
    expect(report.records.some((row) => row.phase === 'failed')).toBe(true);
    expect(report.records.flatMap((row) => row.declared).some((child) => child.name === 'cs_hist_2002')).toBe(true);
    expect(report.records.flatMap((row) => row.declared).some((child) => child.name === 'cs_foreign')).toBe(false);
    expect(report.gaps).toEqual([]);
    expect((await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT)).revision).toBe(report.revision);
  });
  test('压缩清空的原生子身份仍作为缺口返回；旧版本计数不能冒充完整身份历史', async () => {
    const fixture = await deletionFixture(); database = fixture.database;
    const writer = fixture.module.api.owner('data');
    const compacted = await writer.declare({ kind: 'database', ref: 'compacted', projectId: PROJECT, spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_compacted' }] } });
    const changed = await writer.declare({ kind: 'data-binding', ref: 'changed', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: 'cs_old' }] } });
    await writer.declare({ kind: 'data-binding', ref: 'changed', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: 'cs_new' }] } });
    await database.db.execute(sql`UPDATE resources.records SET desired='absent',phase='stopped',spec='{"children":[]}',compacted_at=now() WHERE id=${compacted.id}`);
    await database.db.execute(sql`DELETE FROM resources.children WHERE resource_id=${compacted.id}`);
    const report = await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT);
    expect(report.records.map((row) => row.id)).toContain(compacted.id);
    expect(report.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: compacted.id, code: 'native-identity-compacted' }),
      expect.objectContaining({ resourceId: changed.id, code: 'native-revisions-unavailable' }),
    ]));
    expect(report.gaps.every((gap) => gap.message.length > 0)).toBe(true);
  });
  test('保留原 OID、期望外的原生子对象和未登记所有者，异常声明不会伪装空范围', async () => {
    const fixture = await deletionFixture(); database = fixture.database;
    const writer = fixture.module.api.owner('data');
    const normal = await writer.declare({ kind: 'database', ref: 'normal', projectId: PROJECT, spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_normal', namespace: '' }, { kind: 'Pod', name: 'unrelated', namespace: 'cs-demo' }] } });
    await database.db.execute(sql`UPDATE resources.children SET uid='41000' WHERE resource_id=${normal.id} AND kind='PostgresDatabase'`);
    await database.db.execute(sql`INSERT INTO resources.children(resource_id,kind,name,uid,expected) VALUES (${normal.id},'PostgresRole','cs_old_role','41001',false)`);
    const malformed = await writer.declare({ kind: 'data-binding', ref: 'malformed', projectId: PROJECT, spec: { children: [] } });
    await database.db.execute(sql`UPDATE resources.records SET spec='{"children":[{"kind":"PostgresRole"}]}' WHERE id=${malformed.id}`);
    const misplaced = await fixture.module.api.owner('unknown').declare({ kind: 'route', ref: 'misplaced', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: 'cs_wrong_owner' }] } });
    const childOnly = await fixture.module.api.owner('unknown').declare({ kind: 'route', ref: 'child-only', projectId: PROJECT, spec: { children: [] } });
    await database.db.execute(sql`INSERT INTO resources.children(resource_id,kind,name,uid,expected) VALUES (${childOnly.id},'PostgresRole','cs_orphan','41002',false)`);
    const badSource = await writer.declare({ kind: 'data-binding', ref: 'bad-source', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: 'cs_bad_source', namespace: 'cs-demo' }] } });
    await database.db.execute(sql`UPDATE resources.children SET uid='unknown' WHERE resource_id=${badSource.id}`);
    const report = await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT);
    expect(report.records.find((row) => row.id === normal.id)?.observed).toEqual([
      { kind: 'PostgresDatabase', name: 'cs_normal', uid: '41000', expected: true },
      { kind: 'PostgresRole', name: 'cs_old_role', uid: '41001', expected: false },
    ]);
    expect(report.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: malformed.id, code: 'native-declaration-invalid' }),
      expect.objectContaining({ resourceId: badSource.id, code: 'native-declaration-invalid' }),
      expect.objectContaining({ resourceId: misplaced.id, code: 'native-owner-unknown' }),
      expect.objectContaining({ resourceId: childOnly.id, code: 'native-owner-unknown' }),
    ]));
    expect(report.records.find((row) => row.id === childOnly.id)?.observed[0]?.uid).toBe('41002');
    const previous = report.revision;
    await database.db.execute(sql`UPDATE resources.children SET uid='41003' WHERE resource_id=${normal.id} AND name='cs_old_role'`);
    expect((await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT)).revision).not.toBe(previous);
  });
  test('空保留台账有原项目范围摘要；不可读的版本或数据库拒绝核验，不返回归零证明', async () => {
    const fixture = await deletionFixture(); database = fixture.database;
    const report = await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT);
    expect(report.records).toEqual([]); expect(report.gaps).toEqual([]);
    expect((await fixture.module.api.projectDeletion.nativePostgresHistory(OTHER_PROJECT)).revision).not.toBe(report.revision);
    const row = await fixture.module.api.owner('data').declare({ kind: 'database', ref: 'unsafe-version', projectId: PROJECT, spec: { children: [] } });
    await database.db.execute(sql`UPDATE resources.records SET version=9007199254740992 WHERE id=${row.id}`);
    await expect(fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT)).rejects.toThrow('原键或版本');
    await database.handle.close();
    await expect(fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT)).rejects.toBeDefined();
  });
  test('声明和子对象分步查询仍属于同一原快照；并发改名与新增只在下一次核验出现', async () => {
    const fixture = await deletionFixture(); database = fixture.database;
    const seed = await fixture.module.api.owner('data').declare({ kind: 'database', ref: 'snapshot', projectId: PROJECT, spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_before' }] } });
    await database.db.execute(sql`UPDATE resources.children SET uid='42000' WHERE resource_id=${seed.id}`);
    const id = newResourceId();
    await database.db.execute(sql`INSERT INTO resources.records SELECT left(${id},24)||lpad(n::text,12,'0'),kind,project_id,owner_module,'snapshot-page-'||n,parent_id,purpose,desired,
      jsonb_build_object('children',jsonb_build_array(jsonb_build_object('kind','PostgresDatabase','name','cs_page_'||n))),
      generation,observed_generation,release_reason,status,phase,phase_since,idle_since,retain_until,version,created_at,updated_at,compacted_at
      FROM resources.records CROSS JOIN generate_series(1,500) AS n WHERE id=${seed.id}`);
    const before = await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT);
    let changed = false;
    // 只在真实 SELECT 返回后交错一次独立提交；两侧都执行真实 PostgreSQL，不替换查询结果。
    const db = new Proxy(database.db, {
      get(target, key, receiver) {
        if (key !== 'transaction') return Reflect.get(target, key, receiver);
        return (work: Parameters<typeof target.transaction>[0]) => target.transaction(async (tx) => work(new Proxy(tx, {
          get(current, field, currentReceiver) {
            if (field !== 'execute') return Reflect.get(current, field, currentReceiver);
            return async (...args: Parameters<typeof current.execute>) => {
              const rows = await current.execute(...args);
              if (!changed && rows.some((row) => row['owner_module'] === 'data')) {
                changed = true;
                await database.db.execute(sql`UPDATE resources.records SET spec='{"children":[{"kind":"PostgresDatabase","name":"cs_after"}]}',version=version+1 WHERE id=${seed.id}`);
                await database.db.execute(sql`UPDATE resources.children SET name='cs_after',uid='42001' WHERE resource_id=${seed.id}`);
                await fixture.module.api.owner('data').declare({ kind: 'data-binding', ref: 'snapshot-late', projectId: PROJECT, spec: { children: [{ kind: 'PostgresRole', name: 'cs_late' }] } });
              }
              return rows;
            };
          },
        })));
      },
    });
    const module = createResourcesModule({ db, quotas: { limitFor: async () => 10 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const snapshot = await module.api.projectDeletion.nativePostgresHistory(PROJECT);
    expect(changed).toBe(true); expect(snapshot).toEqual(before);
    const after = await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT);
    expect(before.records).toHaveLength(501); expect(after.records).toHaveLength(502); expect(after.revision).not.toBe(before.revision);
    expect(after.records.find((row) => row.id === seed.id)?.observed[0]?.uid).toBe('42001');
  });
  test('历史里的不可解读 JSON、空原名字和未知 OID 均保留明确阻塞原因', async () => {
    const fixture = await deletionFixture(); database = fixture.database;
    const row = await fixture.module.api.owner('data').declare({ kind: 'database', ref: 'invalid-shapes', projectId: PROJECT, spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_invalid_shapes' }] } });
    for (const spec of [null, true, {}, { children: 'invalid' }, { children: [null] }, { children: [{ kind: null, name: 'x' }] }, { children: [{ kind: 'PostgresRole', name: '' }] }]) {
      await database.db.execute(sql`UPDATE resources.records SET spec=${JSON.stringify(spec)}::jsonb WHERE id=${row.id}`);
      const report = await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT);
      expect(report.records).toHaveLength(1);
      expect(report.gaps).toContainEqual(expect.objectContaining({ resourceId: row.id, code: 'native-declaration-invalid' }));
    }
    await database.db.execute(sql`UPDATE resources.records SET spec='{"children":[]}' WHERE id=${row.id}`);
    await database.db.execute(sql`UPDATE resources.children SET uid='opaque-original' WHERE resource_id=${row.id}`);
    expect((await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT)).gaps).toContainEqual(expect.objectContaining({ code: 'native-declaration-invalid' }));
    await database.db.execute(sql`UPDATE resources.children SET uid=NULL,name='' WHERE resource_id=${row.id}`);
    expect((await fixture.module.api.projectDeletion.nativePostgresHistory(PROJECT)).gaps).toContainEqual(expect.objectContaining({ code: 'native-declaration-invalid' }));
  });
});
