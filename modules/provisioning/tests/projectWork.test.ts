import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { runMigrations, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { projectWorkFixture } from './projectWorkFixture';
import { provisioningCallbackIdentity } from '../domain/projectWork';
import { DomainTopic } from '@crewstation/contracts';
import { publishDomainEvent } from '@crewstation/eventbus';
import { provisioningContainer } from '../domain/projectWork';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('正式开通原工作（真实 PG；容器来源为受控端口）', () => {
  test('伪造会话变量不等于共享锁；原出生和私有 finally 独立提交且不含输入内容', async () => {
    const f = await projectWorkFixture(), value = f.create();
    try {
      await expect(f.database.db.transaction(async (tx) => {
        const pid = Number((await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
        await tx.execute(sql`SELECT set_config('crewstation.shared_admission_pid',${String(pid)},true),set_config('crewstation.shared_admission_keys',${JSON.stringify(['provisioning.project-admission:' + value.projectId])},true)`);
        await tx.execute(sql`INSERT INTO provisioning.original_callbacks(id,project_id,service_id,kind,consumer_id,backend_pid,original_process,input_digest,exit_key_hash)
          VALUES(${newResourceId()},${value.projectId},${value.serviceId},'provision',${newResourceId()},${pid},${JSON.stringify(f.native)}::jsonb,${jsonHash('controlled')},${jsonHash('guessed')})`);
      })).rejects.toMatchObject({ cause: { message: expect.stringContaining('actual admitted') } });
      await f.work.run(value.projectId, value.serviceId, 'provision', jsonHash('controlled-private-input'), async () => {
        expect((await f.work.history(value.projectId))[0]?.exited).toBe(false);
        await expect(f.work.run(f.create().projectId, value.serviceId, 'provision', jsonHash('other'), async () => undefined)).rejects.toThrow();
        await expect(f.work.run(value.projectId, newResourceId(), 'enqueue', jsonHash('other'), async () => undefined)).rejects.toThrow();
        await f.work.run(value.projectId, value.serviceId, 'enqueue', jsonHash('nested'), async () => undefined);
      });
      const rows = await f.work.history(value.projectId);
      expect(rows).toHaveLength(1); expect(rows[0]?.exitDigest).toBe(provisioningCallbackIdentity(rows[0]!));
      expect(JSON.stringify(rows)).not.toContain('controlled-private-input');
      await expect(f.work.run(value.projectId, value.serviceId, 'provision', 'invalid', async () => undefined)).rejects.toThrow();
      for (const statement of [sql`UPDATE provisioning.original_callbacks SET input_digest=${jsonHash('replacement')} WHERE project_id=${value.projectId}`,
        sql`DELETE FROM provisioning.original_callbacks WHERE project_id=${value.projectId}`, sql`TRUNCATE provisioning.original_callbacks`]) await expect(f.database.db.execute(statement).then(() => undefined)).rejects.toThrow();
    } finally { await f.drop(); }
  });
  test('封闭等待实际原开通，其他项目仍可入队；同操作重放与新世代保持永久封写', async () => {
    const f = await projectWorkFixture(), value = f.create(), context = f.context(value), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    f.repository(async () => { entered.resolve(); await release.promise; });
    let pending: Promise<unknown> | undefined, closing: Promise<unknown> | undefined;
    try {
      pending = f.module.api.provisionProject(value.projectId); await entered.promise;
      let closed = false; closing = f.work.close(context).then((result) => { closed = true; return result; });
      await f.module.api.retry(f.create().projectId);
      expect(closed).toBe(false); expect((await f.work.history(value.projectId))[0]?.exited).toBe(false);
      release.resolve(); expect(await pending).toBe('active'); expect(await closing).toEqual({ pending: [] });
      expect(await f.work.close(context)).toEqual({ pending: [] });
      await expect(f.module.api.retry(value.projectId)).rejects.toThrow('永久封闭');
      await expect(f.module.api.reapplyProjectNamespace(value.projectId)).rejects.toThrow('永久封闭');
      const next = { ...context, generation: 2, confirmed: { ...context.confirmed, revision: jsonHash('reconfirmed') } };
      expect(await f.work.close(next)).toEqual({ pending: [] }); await expect(f.work.close(context)).rejects.toThrow('世代');
      await expect(f.work.close({ ...next, operationId: newResourceId() })).rejects.toThrow('原删除操作');
      f.permit(false); await expect(f.work.close(next)).rejects.toThrow('grant-stale');
    } finally { release.resolve(); await Promise.allSettled([pending, closing]); await f.drop(); }
  }, 15_000);
  test('真实连接消失但原 JS 仍活着：封写不冒充退出，公开出生不能伪造 finally，迟到续接零副作用', async () => {
    const f = await projectWorkFixture(), value = f.create(), context = f.context(value), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let effects = 0;
    let originalId: string | undefined;
    const pending = f.work.run(value.projectId, value.serviceId, 'provision', jsonHash('original'), async () => { entered.resolve(); await release.promise; await f.work.checkCurrent(value.projectId); effects++; });
    const failed = pending.then(() => undefined, (error: unknown) => error);
    try {
      await entered.promise; const original = (await f.work.history(value.projectId))[0]!; originalId = original.id;
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${original.backendPid})`); expect(await failed).toBeDefined();
      expect(await f.work.close(context)).toEqual({ pending: [original.id] });
      await f.work.observe(); expect((await f.work.history(value.projectId))[0]?.exited).toBe(false);
      await expect(f.database.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.provisioning_callback_exit',${original.exitKeyDigest},true)`);
        await tx.execute(sql`UPDATE provisioning.original_callbacks SET exited_at=clock_timestamp(),exit_digest=${provisioningCallbackIdentity(original)} WHERE id=${original.id}`);
      })).rejects.toMatchObject({ cause: { message: expect.stringContaining('private original finally') } });
      const exited = f.waitExit(original.id); release.resolve(); await exited;
      expect(effects).toBe(0); expect((await f.work.history(value.projectId))[0]?.exited).toBe(true);
      expect(await f.work.close(context)).toEqual({ pending: [] });
    } finally { release.resolve(); if (originalId) await f.waitExit(originalId); await failed; await f.drop(); }
  }, 15_000);
  test('真正原容器停止的受控来源才可恢复；未知来源、替换容器和未停容器均不补造退出', async () => {
    const f = await projectWorkFixture(), value = f.create();
    try {
      // Seed a persisted original birth on a real shared backend, representing the old process before its actual source reports termination.
      await withSharedDatabaseAdmission(f.database.db, 'provisioning.project-admission:' + value.projectId, async (locked) => {
        const pid = Number((await locked.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
        await f.database.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO provisioning.original_callbacks(id,project_id,service_id,kind,consumer_id,backend_pid,original_process,input_digest,exit_key_hash)
          VALUES(${newResourceId()},${value.projectId},${value.serviceId},'provision',${newResourceId()},${pid},${JSON.stringify(f.native)}::jsonb,${jsonHash('original')},${jsonHash('unavailable original private key')})`); });
      });
      await f.work.observe(); expect((await f.work.history(value.projectId))[0]?.exited).toBe(false);
      f.sourceFailure(true); await expect(f.work.observe()).rejects.toThrow('source-unavailable'); f.sourceFailure(false);
      await expect(f.database.db.execute(sql`UPDATE provisioning.original_callbacks SET exited_at=clock_timestamp(),recovery_digest=${jsonHash('guessed')},exit_digest=${jsonHash('guessed')}`).then(() => undefined)).rejects.toThrow();
      f.stopped(true); f.stopIdentity({ ...provisioningContainer(f.native), containerId: 'containerd://' + 'b'.repeat(64) });
      await f.work.observe(); expect((await f.work.history(value.projectId))[0]?.exited).toBe(false);
      f.stopIdentity(provisioningContainer(f.native)); await f.work.observe(); const ended = (await f.work.history(value.projectId))[0]!;
      expect(ended.exited).toBe(true); expect(ended.recoveryDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(ended.exitDigest).toBe(provisioningCallbackIdentity(ended, ended.recoveryDigest!));
      await f.work.observe(); expect(await f.work.history(value.projectId)).toEqual([ended]);
      for (const statement of [sql`UPDATE provisioning.callback_stops SET digest=${jsonHash('replacement')}`, sql`TRUNCATE provisioning.callback_stops`, sql`TRUNCATE provisioning.project_admissions`])
        await expect(f.database.db.execute(statement).then(() => undefined)).rejects.toThrow();
    } finally { await f.drop(); }
  });
  test('来源不能用错误 PID、隐藏字段或保护期间撤销的项目权限登记出生', async () => {
    const f = await projectWorkFixture(), value = f.create();
    try {
      f.protect({ ...f.native, pid: process.pid + 1 }); await expect(f.module.api.retry(value.projectId)).rejects.toThrow('PID');
      f.protect({ ...f.native, unexpected: 'not-a-secret' } as typeof f.native); await expect(f.module.api.retry(value.projectId)).rejects.toThrow();
      f.protect(f.native); f.protecting(async () => { f.facts.set(value.projectId, { ...value, state: 'deleting' }); });
      await expect(f.module.api.retry(value.projectId)).rejects.toThrow('project-unavailable'); f.protecting(async () => undefined);
      f.protect(f.native); f.facts.set(value.projectId, { ...value, state: 'deleting' });
      expect(await f.module.api.provisionProject(value.projectId)).toBe('skipped'); await expect(f.module.api.retry(value.projectId)).rejects.toThrow('不再接受');
      expect(await f.work.history(value.projectId)).toHaveLength(0);
      await expect(f.work.close({ ...f.context(value), phase: 'stop' })).rejects.toThrow('封写');
      await expect(f.work.close({ ...f.context(value), confirmed: { ...f.context(value).confirmed, complete: false } })).rejects.toThrow('封写');
    } finally { await f.drop(); }
  });
  test('原 Pod 整体停止覆盖已不在 lastState 的容器观测；异节点／异 Pod 不恢复，停止事实不可改写', async () => {
    const f = await projectWorkFixture({ beforePodStopMigration: true }), value = f.create(), other = f.create();
    try {
      for (const [facts, processIdentity] of [[value, f.native], [value, { ...f.native,containerId: 'containerd://' + 'b'.repeat(64) }],
        [other, { ...f.native,podUid: newResourceId() }]] as const) {
        await withSharedDatabaseAdmission(f.database.db,'provisioning.project-admission:' + facts.projectId, async (locked) => {
          const pid = Number((await locked.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
          await f.database.db.transaction(async (tx) => { await tx.execute(sql`INSERT INTO provisioning.original_callbacks(id,project_id,service_id,kind,consumer_id,backend_pid,original_process,input_digest,exit_key_hash)
            VALUES(${newResourceId()},${facts.projectId},${facts.serviceId},'provision',${newResourceId()},${pid},${JSON.stringify(processIdentity)}::jsonb,${jsonHash('old callback')},${jsonHash('private old key unavailable')})`); });
        });
      }
      const before = await f.work.history(value.projectId);
      await expect(f.database.db.execute(sql`UPDATE provisioning.original_callbacks SET input_digest=${jsonHash('rewrite')} WHERE project_id=${value.projectId}`).then(() => undefined)).rejects.toThrow();
      expect(await runMigrations(f.database.db,[f.module.migrations])).toEqual(['provisioning/0002_pod_work_stop.sql','provisioning/0003_database_admission.sql']);
      expect(await f.work.history(value.projectId)).toEqual(before);
      await f.work.observe(); expect((await f.work.history(value.projectId)).every((row) => !row.exited)).toBe(true);
      f.wholeStopped(true); f.podIdentity({ podUid: f.native.podUid,nodeUid: newResourceId(),nodeName: f.native.nodeName });
      await f.work.observe(); expect((await f.work.history(value.projectId)).every((row) => !row.exited)).toBe(true);
      f.podIdentity({ podUid: f.native.podUid,nodeUid: f.native.nodeUid,nodeName: f.native.nodeName }); await f.work.observe();
      const original = await f.work.history(value.projectId);
      expect(original).toHaveLength(2); expect(original.every((row) => row.exited && row.exitDigest === provisioningCallbackIdentity(row,row.recoveryDigest!))).toBe(true);
      expect((await f.work.history(other.projectId))[0]?.exited).toBe(false);
      await f.work.observe(); expect(await f.work.history(value.projectId)).toEqual(original);
      for (const statement of [sql`UPDATE provisioning.pod_stops SET digest=${jsonHash('replacement')}`,sql`DELETE FROM provisioning.pod_stops`,sql`TRUNCATE provisioning.pod_stops`])
        await expect(f.database.db.execute(statement).then(() => undefined)).rejects.toThrow();
    } finally { await f.drop(); }
  });
  test('命名空间声明期间受理删除，不能继续写策略、建仓、建库或回写 active；重下发按原项目核对', async () => {
    const f = await projectWorkFixture(), value = f.create();
    try {
      f.declared(async () => { f.facts.set(value.projectId, { ...value, state: 'deleting' }); });
      expect(await f.module.api.provisionProject(value.projectId)).toBe('failed');
      expect(f.calls).toEqual(['declare:namespace']); expect(f.facts.get(value.projectId)?.state).toBe('deleting');
      expect((await f.work.history(value.projectId))[0]?.exited).toBe(true);
      f.declared(async () => undefined); const other = f.create();
      expect(await f.module.api.reapplyNamespaces()).toEqual({ applied: 1, failed: 0 });
      expect((await f.work.history(other.projectId))[0]?.kind).toBe('namespace-reapply');
      expect((await f.work.history(other.projectId))[0]?.exited).toBe(true);
      const context = f.context(other); await f.work.close(context);
      expect(await f.module.api.reapplyNamespaces()).toEqual({ applied: 0, failed: 1 });
    } finally { await f.drop(); }
  });
  test('迟到 project.created 不重建删除中项目，也不阻塞后续其他项目入队', async () => {
    const f = await projectWorkFixture(), value = f.create(), other = f.create();
    try {
      await f.work.close(f.context(value)); f.facts.set(value.projectId, { ...value, state: 'deleting' });
      for (const item of [value, other]) await publishDomainEvent(f.database.db, DomainTopic.projectCreated,
        { occurredAt: new Date().toISOString(), projectId: item.projectId, slug: item.slug, kind: item.kind, namespace: item.namespace });
      expect(await f.module.subscriptions.runOnce()).toBe(2);
      const jobs = await f.database.db.execute<{ payload: { projectId: string } }>(sql`SELECT payload FROM platform_infra.jobs WHERE kind='project.provision' ORDER BY id`);
      expect(jobs.map((row) => row.payload.projectId)).toEqual([other.projectId]);
      expect(await f.work.history(value.projectId)).toHaveLength(0); expect((await f.work.history(other.projectId))[0]?.kind).toBe('enqueue');
    } finally { await f.drop(); }
  });
});
