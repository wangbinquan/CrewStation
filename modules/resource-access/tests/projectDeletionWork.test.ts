import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { resourceAccessRepository } from '../adapters/persistence/repository';
import { applicationWorkFixture, waitForApplicationDatabase } from './projectDeletionWorkFixture';
import { resourceAccessDeletionFixture, type ResourceAccessDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable(); let f: ResourceAccessDeletionFixture;
afterEach(async () => { await f?.db.drop(); });
describe.skipIf(!available)('资源申请实际应用退出屏障（真实 PG）', () => {
  test('真实工作器的外部调用未结束前不能封写；回执改变确认材料时保持阻塞', async () => {
    f = await resourceAccessDeletionFixture(); const work = await applicationWorkFixture(f);
    let seal: ReturnType<NonNullable<typeof work.application.api.deletionOwner>['run']> | undefined;
    try {
      await expect(Promise.resolve(f.db.db.execute(sql`UPDATE resource_access.deletion_work SET state='finished' WHERE change_id=${work.change.id}`))).rejects.toMatchObject({ cause: { message: 'resource application exit requires original proof' } });
      await expect(Promise.resolve(f.db.db.execute(sql`DELETE FROM resource_access.deletion_work WHERE change_id=${work.change.id}`))).rejects.toMatchObject({ cause: { message: 'resource application work cleanup requires finished proof' } });
      const started = await f.begin(); let done = false;
      seal = work.application.api.deletionOwner!.run(started.context).finally(() => { done = true; });
      expect(await waitForApplicationDatabase(f, 'seal-wait')).toBe(true); expect(done).toBe(false);
    } finally { work.release(); await work.running; }
    expect(await seal).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    expect(await waitForApplicationDatabase(f, 'work-finished')).toBe(true); expect(work.writes()).toBe(1);
    let called = false;
    await expect(resourceAccessRepository(f.db.db).withAdmission(f.own.id, async () => { called = true; })).rejects.toMatchObject({ kind: 'precondition' });
    expect(called).toBe(false);
  });
  test('实际准入连接被终止不会被当作退出；持久事实等待原回调，迟到内容不能重新写入', async () => {
    f = await resourceAccessDeletionFixture(); const work = await applicationWorkFixture(f);
    try {
      const started = await f.begin();
      const [claim] = await f.db.db.execute<{ backend_pid: number }>(sql`SELECT backend_pid FROM resource_access.deletion_work WHERE change_id=${work.change.id} AND state='running'`);
      expect(claim?.backend_pid).toBeGreaterThan(0);
      await f.db.db.execute(sql`SELECT pg_terminate_backend(${claim!.backend_pid})`);
      expect(await work.application.api.deletionOwner!.run(started.context)).toMatchObject({ kind: 'waiting' });
      expect((await f.db.db.execute(sql`SELECT state FROM resource_access.deletion_work WHERE change_id=${work.change.id}`))[0]?.state).toBe('running');
      work.release(); await work.running;
      expect(await waitForApplicationDatabase(f, 'work-finished')).toBe(true);
      expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('done');
      expect((await f.db.db.execute(sql`SELECT state FROM resource_access.changes WHERE id=${work.change.id}`))[0]?.state).toBe('applying');
      expect(work.writes()).toBe(1);
    } finally { work.release(); await work.running; }
  });
  test('控制器丢连接后只凭原 operationId 的领域提交回执恢复退出，不重复调用分配', async () => {
    f = await resourceAccessDeletionFixture(); const work = await applicationWorkFixture(f, true);
    try {
      const started = await f.begin();
      const [claim] = await f.db.db.execute<{ backend_pid: number }>(sql`SELECT backend_pid FROM resource_access.deletion_work WHERE change_id=${work.change.id}`);
      await f.db.db.execute(sql`SELECT pg_terminate_backend(${claim!.backend_pid})`);
      expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('done');
      const [proof] = await f.db.db.execute<{ state: string; recovery_digest: string }>(sql`SELECT state,recovery_digest FROM resource_access.deletion_work WHERE change_id=${work.change.id}`);
      expect(proof?.state).toBe('finished'); expect(proof?.recovery_digest).toMatch(/^[a-f0-9]{64}$/); expect(work.writes()).toBe(1);
    } finally { work.release(); await work.running; }
  });
});
