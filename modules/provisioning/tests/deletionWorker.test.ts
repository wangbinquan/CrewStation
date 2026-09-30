import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newId, noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { enqueueJob, getJobState, queueMigrations } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { deletionEnqueue, PROJECT_DELETION_JOB_KIND, projectDeletionRuntime } from '../workers/projectDeletionRuntime';
import { createProvisioningModule } from '../wiring';
import type { DeletionFixture } from './deletionFixture';
import { deletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable(); let f: DeletionFixture;
beforeAll(async () => { if (available) { f = await deletionFixture(); await runMigrations(f.database.db, [queueMigrations]); } });
afterAll(async () => { await f?.database.drop(); });
describe.skipIf(!available)('持久删除工作器与完整装配门（真实 PG）', () => {
  test('持久入队按原操作去重，真实队列心跳驱动 owner，全部回执后作业和操作才完成', async () => {
    const { operation } = await f.start(), enqueue = deletionEnqueue(f.database.db);
    await enqueue(operation.id); await enqueue(operation.id);
    const rows = await f.database.db.execute<{ id: number }>(`SELECT id FROM platform_infra.jobs WHERE kind = '${PROJECT_DELETION_JOB_KIND}' AND dedup_key = '${operation.id}'`);
    expect(rows).toHaveLength(1);
    const runtime = projectDeletionRuntime(f.database.db, f.controller, 'queue-test', noopLogger);
    expect(await runtime.worker.runOnce()).toBe(1);
    expect((await getJobState(f.database.db, rows[0]!.id))?.state).toBe('done');
    expect((await f.controller.read(f.admin, operation.id)).state).toBe('succeeded');
    await expect(enqueue('unsafe-operation')).rejects.toThrow();
    const bad = await enqueueJob(f.database.db, PROJECT_DELETION_JOB_KIND, { operationId: 'unsafe-operation' }, { maxAttempts: 1 });
    if (bad.id === null) throw new Error('invalid-payload job was not created');
    expect(await runtime.worker.runOnce()).toBe(1); expect((await getJobState(f.database.db, bad.id))?.state).toBe('dead');
    await runtime.worker.stop();
  });
  test('外部步骤异常不把原始来源错误或凭据写进队列失败内容', async () => {
    const { operation } = await f.start();
    const owner = f.external.owners.find((o) => o.participant === 'scm')!, original = owner.run;
    owner.run = async () => { throw new Error('private-secret-must-not-reach-progress-or-queue'); };
    const job = await enqueueJob(f.database.db, PROJECT_DELETION_JOB_KIND, { operationId: operation.id }, { maxAttempts: 1 });
    try {
      const runtime = projectDeletionRuntime(f.database.db, f.controller, 'failure-test', noopLogger);
      expect(await runtime.worker.runOnce()).toBe(1);
      if (job.id === null) throw new Error('failure job was not created');
      const state = await getJobState(f.database.db, job.id); expect(state?.state).toBe('dead');
      expect(state?.lastError).not.toContain('private-secret');
      const current = await f.controller.read(f.admin, operation.id); expect(current.state).toBe('needs-attention');
      expect(JSON.stringify(current)).not.toContain('private-secret'); await runtime.worker.stop();
    } finally { owner.run = original; }
  });
  test('恢复扫描非重叠，关闭等待本轮扫描并停止后续计时器', async () => {
    let finish!: () => void, calls = 0;
    const scanning = new Promise<void>((resolve) => { finish = resolve; });
    const runtime = projectDeletionRuntime(f.database.db, { ...f.controller, recover: async () => { calls++; await scanning; } }, 'recovery-test', noopLogger);
    runtime.recovery.start(); runtime.recovery.start(); expect(calls).toBe(1);
    let stopped = false; const stopping = runtime.recovery.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); finish(); await stopping; expect(stopped).toBe(true); expect(calls).toBe(1);
  });
  test('不提供全参与者装配时，没有永久删除 HTTP、工作器或恢复扫描；完整配置才开放', () => {
    const deps = { db: f.database.db, steps: { loadProject: async () => undefined, listProjects: async () => [], ensureRepository: async () => {}, ensureData: async () => {},
      reconcileRoutes: async () => {}, ensureFirstRelease: async () => {}, setProjectState: async () => {} },
    ledger: { declare: async () => ({ id: newId('record') }), get: async () => undefined }, namespaces: { systemNamespace: 'system' }, workerOwner: 'composition', consumerName: 'composition', isAdmin: async () => true };
    const closed = createProvisioningModule(deps);
    expect(closed.api.deletions).toBeUndefined(); expect(closed.http).toHaveLength(1); expect(closed.workers).toHaveLength(1); expect(closed.startupTasks).toHaveLength(1);
    expect(() => createProvisioningModule({ ...deps, deletion: { intents: f.intents, owners: f.external.owners.slice(1) } })).toThrow();
    const complete = createProvisioningModule({ ...deps, deletion: { intents: f.intents, owners: f.external.owners } });
    expect(complete.api.deletions).toBeDefined(); expect(complete.http).toHaveLength(2); expect(complete.workers).toHaveLength(2); expect(complete.startupTasks).toHaveLength(2);
  });
});
