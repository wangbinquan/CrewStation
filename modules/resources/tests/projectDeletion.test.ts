import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { connectDatabase, runMigrations } from '@crewstation/persistence';
import type { TestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { resourcesMigrations } from '../wiring';
import { CONTENT } from '../adapters/persistence/deletion/scope';
import { deletionControls, deletionFixture, TARGET } from './deletionFixture';
import { OTHER_PROJECT, PROJECT, workspace } from './fixtures';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('项目清理台账、原身份墓碑与跨实例准入（真实 PG）', () => {
  let database: TestDatabase;
  afterEach(async () => { await database?.drop(); });
  test('旧库升级保留台账；封闭后拒绝新声明、移动项目及旧资源复活，正常停止仍能推进', async () => {
    database = await createTestDatabase([{ ...resourcesMigrations, files: resourcesMigrations.files.filter((entry) => entry.name < '0004_') }]);
    const fixture = deletionControls(database), writer = fixture.module.api.owner('task-runtime');
    const record = await writer.declare(workspace('original'));
    await runMigrations(database.db, [resourcesMigrations]); await fixture.plan();
    expect((await fixture.run('seal')).kind).toBe('done');
    await expect(writer.declare(workspace('late'))).rejects.toMatchObject({ kind: 'precondition', details: { code: 'project_deleting' } });
    await expect(Promise.resolve(database.db.execute(sql`UPDATE resources.records SET project_id = ${OTHER_PROJECT} WHERE id = ${record.id}`))).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(Promise.resolve(database.db.execute(sql`DELETE FROM resources.records WHERE id = ${record.id}`))).rejects.toMatchObject({ cause: { code: '55000' } });
    await writer.requestRelease(record.id, { code: 'project-deleting', message: '项目清理' });
    expect((await fixture.module.api.get(record.id))?.desired).toBe('absent');
    await expect(Promise.resolve(database.db.execute(sql`UPDATE resources.records SET desired = 'present' WHERE id = ${record.id}`))).rejects.toMatchObject({ cause: { code: '55000' } });
    const restarted = deletionControls(database); let calls = 0;
    expect(await restarted.module.api.projectDeletion.withAdmission(PROJECT, async () => { calls++; })).toBe(false); expect(calls).toBe(0);
    expect((await fixture.module.api.get(record.id))?.projectId).toBe(PROJECT);
  });
  test('持久共享准入覆盖在途实际写与嵌套台账事务，排他封闭等待所有在途完成', async () => {
    const fixture = await fixtureForConcurrency(); database = fixture.database;
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
    const inflight = fixture.module.api.projectDeletion.withAdmission(PROJECT, async () => {
      await fixture.module.api.owner('task-runtime').declare(workspace('nested-before-seal'));
      entered(); await hold;
    });
    await started; await fixture.plan();
    let otherEntered = false;
    expect(await fixture.module.api.projectDeletion.withAdmission(PROJECT, async () => { otherEntered = true; })).toBe(true); expect(otherEntered).toBe(true);
    const sealing = fixture.run('seal');
    try {
      const deadline = Date.now() + 3000; let waiters = 0;
      while (!waiters && Date.now() < deadline) {
        waiters = Number((await database.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`))[0]?.count);
        if (!waiters) await Bun.sleep(10);
      }
      expect(waiters).toBeGreaterThan(0); expect(fixture.effects).toEqual([]);
    } finally { release(); }
    expect(await inflight).toBe(true); expect((await sealing).kind).toBe('done');
    let after = 0; expect(await fixture.module.api.projectDeletion.withAdmission(PROJECT, async () => { after++; })).toBe(false); expect(after).toBe(0);
  });
  test('单连接池在 seal 排队后仍能独立提交停止 UOW；已释放的锁身份不能再绕过持久屏障', async () => {
    database = await createTestDatabase([resourcesMigrations]);
    const single = connectDatabase(database.url, { max: 1 }), fixture = deletionControls({ ...database, db: single.db });
    let release!: () => void, entered!: () => void, guardPid = '';
    const hold = new Promise<void>((resolve) => { release = resolve; }), started = new Promise<void>((resolve) => { entered = resolve; });
    try {
      const writer = fixture.module.api.owner('task-runtime'), record = await writer.declare(workspace('small-pool'));
      const inflight = fixture.module.api.projectDeletion.withAdmission(PROJECT, async () => {
        guardPid = (await single.db.transaction((tx) => tx.execute<{ pid: string }>(sql`SELECT current_setting('crewstation.shared_admission_pid') AS pid`)))[0]!.pid;
        entered(); await hold;
        await writer.requestRelease(record.id, { code: 'project-deleting', message: '原请求停止' });
        expect((await database.db.execute<{ desired: string }>(sql`SELECT desired FROM resources.records WHERE id = ${record.id}`))[0]?.desired).toBe('absent');
      });
      await started; await fixture.plan();
      const sealing = fixture.run('seal');
      try {
        let waiting = false; const deadline = Date.now() + 2000;
        while (!waiting && Date.now() < deadline) { waiting = (await database.db.execute<{ found: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS found`))[0]!.found; if (!waiting) await Bun.sleep(10); }
        expect(waiting).toBe(true);
      } finally { release(); }
      expect(await inflight).toBe(true); expect((await sealing).kind).toBe('done');
      await expect(single.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.shared_admission_pid',${guardPid},true),set_config('crewstation.shared_admission_key',${`resources.project-admission:${PROJECT}`},true)`);
        expect((await tx.execute<{ valid: boolean }>(sql`SELECT resources.actual_shared_admission(${PROJECT}) AS valid`))[0]?.valid).toBe(false);
        await tx.execute(sql`UPDATE resources.records SET desired = 'present' WHERE id = ${record.id}`);
      })).rejects.toMatchObject({ cause: { code: '55000' } });
    } finally { release?.(); await single.close(); }
  }, 10_000);
  test('全量历史及间接关联清零；保留其他项目，迟到租约、消费者和证明不能凭旧键复活', async () => {
    const fixture = await fixtureForConcurrency(); database = fixture.database;
    const writer = fixture.module.api.owner('task-runtime'), record = await writer.declare(workspace('original')), other = await writer.declare(workspace('other', { projectId: OTHER_PROJECT })), consumer = newResourceId();
    await database.db.execute(sql`INSERT INTO resources.children(resource_id,kind,namespace,name,uid) VALUES (${record.id},'Pod',${TARGET.namespace},'original','original-uid')`);
    await database.db.execute(sql`INSERT INTO resources.aliases(source,alias,resource_id) VALUES ('tsk','legacy-original',${record.id})`);
    await database.db.execute(sql`INSERT INTO resources.leases(resource_id,holder,expires_at) VALUES (${record.id},'controller',clock_timestamp()+interval '1 minute')`);
    await database.db.execute(sql`INSERT INTO resources.task_volume_safety(resource_id,body) VALUES (${record.id},'{}')`);
    await database.db.execute(sql`INSERT INTO resources.workload_consumers(id,task_id,resource_id,namespace,pod_name,consumer) VALUES (${consumer},${record.id},${record.id},${TARGET.namespace},'original','{"material":"project-private"}')`);
    await database.db.execute(sql`INSERT INTO resources.workload_stop_proofs(consumer_id,record) VALUES (${consumer},'{"material":"project-private"}')`);
    await database.db.execute(sql`INSERT INTO resources.task_storage_fences(task_id,sealed) VALUES (${record.id},true)`);
    await database.db.execute(sql`INSERT INTO resources.workload_stop_scans(task_id,revision,scope,body) VALUES (${record.id},1,'all','{"material":"project-private"}')`);
    await database.db.execute(sql`INSERT INTO resources.workload_admission_closures(id,identity) VALUES (${consumer},jsonb_build_object('resourceId',${record.id}::text))`);
    await database.db.execute(sql`INSERT INTO resources.project_locks(project_id) VALUES (${PROJECT}) ON CONFLICT DO NOTHING`);
    await database.db.execute(sql`INSERT INTO resources.changes(project_id,resource_id,version,change) SELECT ${PROJECT},${record.id},n,'upsert' FROM generate_series(1,2002) n`);
    const plan = await fixture.plan(); expect(plan.resources.find((entry) => entry.kind === 'metadata:changes')!.count).toBeGreaterThan(2000);
    expect((await fixture.run('seal')).kind).toBe('done'); fixture.wait(true); expect((await fixture.run('stop')).kind).toBe('waiting');
    expect(await fixture.module.api.get(record.id)).toBeDefined(); fixture.wait(false);
    expect((await fixture.run('stop')).kind).toBe('done'); expect((await fixture.run('purge')).kind).toBe('done'); expect((await fixture.run('prove')).kind).toBe('done');
    expect((await fixture.run('metadata')).kind).toBe('done'); expect((await fixture.run('metadata')).kind).toBe('done'); expect((await fixture.run('verify')).kind).toBe('done');
    const remaining = await fixture.owner.inspect(TARGET); expect(remaining.resources.filter((entry) => entry.kind.startsWith('metadata:')).every((entry) => entry.count === 0)).toBe(true);
    expect(await fixture.module.api.get(other.id)).toBeDefined(); expect(await fixture.module.api.get(record.id)).toBeUndefined();
    await expect(Promise.resolve(database.db.execute(sql`INSERT INTO resources.leases(resource_id,holder,expires_at) VALUES (${record.id},'late',clock_timestamp())`))).rejects.toMatchObject({ cause: { code: '55000' } });
    await expect(Promise.resolve(database.db.execute(sql`INSERT INTO resources.workload_stop_proofs(consumer_id,record) VALUES (${consumer},'{}')`))).rejects.toMatchObject({ cause: { code: '55000' } });
    const identities = await database.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM resources.deletion_identities WHERE project_id = ${PROJECT}`); expect(Number(identities[0]?.count)).toBeGreaterThanOrEqual(3);
    expect(CONTENT).toHaveLength(12);
  });
  test('源变化封闭后阻断，旧世代或不相符的集群许可不写；共享引用和未知表阻断完整性', async () => {
    const fixture = await fixtureForConcurrency(); database = fixture.database;
    const record = await fixture.module.api.owner('task-runtime').declare(workspace('original')); await fixture.plan();
    await fixture.module.api.owner('task-runtime').declare(workspace('late'));
    expect((await fixture.run('seal')).kind).toBe('blocked');
    expect(await fixture.module.api.projectDeletion.withAdmission(PROJECT, async () => { throw new Error('must not run'); })).toBe(false);
    fixture.takeover(); await expect(fixture.run('metadata', { generation: 1 })).rejects.toThrow('失效');
    const cluster = { ...fixture.context('seal'), confirmed: { ...fixture.context('seal').confirmed, participant: 'cluster-control' as const, revision: 'a'.repeat(64) } };
    await fixture.module.api.projectDeletion.sealClusterAdmission(cluster, fixture.grant);
    await fixture.module.api.projectDeletion.assertClusterAdmission(cluster, fixture.grant);
    await expect(fixture.module.api.projectDeletion.assertClusterAdmission({ ...cluster, confirmed: { ...cluster.confirmed, revision: 'b'.repeat(64) } }, fixture.grant)).rejects.toThrow('许可');
    await database.db.execute(sql`INSERT INTO resources.records SELECT ${newResourceId()},kind,${OTHER_PROJECT},owner_module,'foreign-reference',id,purpose,desired,spec,generation,observed_generation,release_reason,status,phase,phase_since,idle_since,retain_until,version,created_at,updated_at,compacted_at FROM resources.records WHERE id = ${record.id}`);
    expect((await fixture.owner.inspect(TARGET)).blockers[0]?.code).toBe('shared-resource');
    await expect(fixture.run('metadata')).rejects.toThrow('跨项目'); expect(await fixture.module.api.get(record.id)).toBeDefined();
    await database.db.execute(sql`CREATE TABLE resources.future_materials(id text PRIMARY KEY)`);
    await expect(fixture.owner.inspect(TARGET)).rejects.toThrow('未登记');
  });
  test('许可失效不封闭；不完整来源或仅 metadata 回执不能签成物理清理成功', async () => {
    const fixture = await fixtureForConcurrency(); database = fixture.database; await fixture.plan();
    fixture.revoke(); await expect(fixture.run('seal')).rejects.toThrow('失效');
    expect(await fixture.module.api.projectDeletion.withAdmission(PROJECT, async () => undefined)).toBe(true);
    const fresh = deletionControls(database); await fresh.plan(); expect((await fresh.run('seal')).kind).toBe('done');
    fresh.physics.stop = async () => ({ kind: 'done', evidence: { kind: 'metadata', digest: 'a'.repeat(64), description: '只有数据库状态，缺少实际停止', count: 1 } });
    await expect(fresh.run('stop')).rejects.toThrow('物理来源');
    const original = fresh.physics.inspect; fresh.physics.inspect = async (target) => ({ ...await original(target), complete: false });
    expect((await fresh.owner.inspect(TARGET)).complete).toBe(false);
  });
  test('原 PVC 消失后的 PV 归属仍由原 UID 证明；同名卷、其他项目及无来源身份不能认领', async () => {
    const fixture = await fixtureForConcurrency(); database = fixture.database;
    const record = await fixture.module.api.owner('task-runtime').declare(workspace('volume-owner'));
    await database.db.execute(sql`INSERT INTO resources.children(resource_id,kind,namespace,name,uid,observed) VALUES (${record.id},'PersistentVolumeClaim',${TARGET.namespace},'work','original-pvc','{"phase":"absent"}')`);
    const owns = fixture.module.api.projectDeletion.ownsVolume;
    expect(await owns(PROJECT, { name: 'pv', uid: 'original-pv', claim: { namespace: TARGET.namespace, uid: 'original-pvc' } })).toBe(true);
    expect(await owns(PROJECT, { name: 'pv', uid: 'replacement', claim: { namespace: TARGET.namespace, uid: 'foreign-pvc' } })).toBe(false);
    expect(await owns(OTHER_PROJECT, { name: 'pv', uid: 'original-pv', claim: { namespace: TARGET.namespace, uid: 'original-pvc' } })).toBe(false);
    await database.db.execute(sql`INSERT INTO resources.task_volume_safety(resource_id,body) VALUES (${record.id},'{"target":{"pvName":"pv","pvUid":"original-pv"}}')`);
    expect(await owns(PROJECT, { name: 'pv', uid: 'replacement', claim: { namespace: TARGET.namespace, uid: 'original-pvc' } })).toBe(false);
    await database.db.execute(sql`DELETE FROM resources.children WHERE resource_id = ${record.id}`);
    expect(await owns(PROJECT, { name: 'pv', uid: 'original-pv' })).toBe(true);
    expect(await owns(PROJECT, { name: 'pv', uid: 'replacement' })).toBe(false);
    expect(await owns(PROJECT, { name: 'other-name', uid: 'original-pv' })).toBe(false);
    expect(await owns(PROJECT, { name: '', uid: '' })).toBe(false);
  });
});
// 使异步 fixture 名称与 describe 内的 helper 不互相遮蔽。
const fixtureForConcurrency = deletionFixture;
