import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS, PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import type { ProjectDeletionParticipant } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
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
  test('封闭遇到首个阻塞仍关闭后续来源，汇总全部原因且不停止或清理，恢复同一原操作', async () => {
    const { value, operation } = await f.start(), foreign = await f.create();
    const blocked = new Set<ProjectDeletionParticipant>(['release', 'cluster-management']);
    const originals = f.external.owners.filter((owner) => blocked.has(owner.participant)).map((owner) => ({ owner, run: owner.run }));
    for (const { owner, run } of originals) owner.run = async (context) => {
      const result = await run(context);
      return context.phase === 'seal' ? { kind: 'blocked', blockers: [{ participant: owner.participant, code: 'inventory-changed', message: '原来源已封闭，需要重新核对' }] } : result;
    };
    try {
      await f.controller.advance(operation.id);
      const current = await f.controller.read(f.admin, operation.id);
      expect(current.state).toBe('needs-attention'); expect(current.phase).toBe('seal');
      expect(current.blockers.map((blocker) => blocker.participant).sort()).toEqual([...blocked].sort());
      expect(current.receipts).toHaveLength(PROJECT_DELETION_PARTICIPANTS.length - blocked.size);
      expect(current.receipts.every((receipt) => receipt.phase === 'seal')).toBe(true);
      expect(f.external.calls.filter((call) => call.projectId === value.id).every((call) => call.phase === 'seal')).toBe(true);
      for (const owner of f.external.owners.filter((owner) => owner.participant !== 'project')) {
        expect(f.external.state(owner.participant, value.id)).toMatchObject({ sealed: true, exists: true, running: true, storage: true, metadata: true });
        expect(f.external.state(owner.participant, foreign.id)).toMatchObject({ sealed: false, exists: true, running: true, storage: true, metadata: true });
      }
      for (const { owner, run } of originals) owner.run = run;
      await f.controller.retry(f.admin, operation.id); await f.controller.advance(operation.id);
      const completed = await f.controller.read(f.admin, operation.id);
      expect(completed.id).toBe(operation.id); expect(completed.state).toBe('succeeded'); expect(completed.receipts).toHaveLength(154);
    } finally { for (const { owner, run } of originals) owner.run = run; }
  });
  test('封闭等待时后续来源仍关闭，仅缺原等待回执，不进入后续阶段，原操作可继续', async () => {
    const { value, operation } = await f.start();
    const owner = f.external.owners.find((entry) => entry.participant === 'release')!, original = owner.run;
    owner.run = async (context) => {
      const result = await original(context);
      return context.phase === 'seal' ? { kind: 'waiting', reason: '等待原来源完整核对' } : result;
    };
    try {
      await f.controller.advance(operation.id);
      const current = await f.controller.read(f.admin, operation.id);
      expect(current.phase).toBe('seal'); expect(current.receipts).toHaveLength(PROJECT_DELETION_PARTICIPANTS.length - 1);
      expect(current.receipts.every((receipt) => receipt.phase === 'seal')).toBe(true);
      expect(f.external.calls.filter((call) => call.projectId === value.id).every((call) => call.phase === 'seal')).toBe(true);
      for (const entry of f.external.owners.filter((entry) => entry.participant !== 'project')) expect(f.external.state(entry.participant, value.id)).toMatchObject({ sealed: true, exists: true, running: true, storage: true, metadata: true });
      owner.run = original; f.elapse(15_001); await f.controller.advance(operation.id);
      const completed = await f.controller.read(f.admin, operation.id);
      expect(completed.id).toBe(operation.id); expect(completed.state).toBe('succeeded'); expect(completed.receipts).toHaveLength(154);
    } finally { owner.run = original; }
  });
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
  test('全参与者装配前只返回能力关闭，不开放删除操作、工作器或恢复扫描；完整配置才开放', async () => {
    const deps = { db: f.database.db, steps: { loadProject: async () => undefined, listProjects: async () => [], ensureRepository: async () => {}, ensureData: async () => {},
      reconcileRoutes: async () => {}, ensureFirstRelease: async () => {}, setProjectState: async () => {} },
    ledger: { declare: async () => ({ id: newId('record') }), get: async () => undefined }, namespaces: { systemNamespace: 'system' }, workerOwner: 'composition', consumerName: 'composition', isAdmin: async () => true };
    const closed = createProvisioningModule(deps);
    expect(closed.api.deletions).toBeUndefined(); expect(closed.http).toHaveLength(2); expect(closed.workers).toHaveLength(1); expect(closed.startupTasks).toHaveLength(1);
    const app = createApp({ name: 'closed-project-deletion' });
    for (const route of closed.http) app.route('/', route);
    const headers = { [IDENTITY_HEADERS.userId]: f.admin.userId };
    const capabilities = await app.request('/v1/project-deletions/capabilities', { headers });
    expect(capabilities.status).toBe(200); expect(await capabilities.json()).toEqual({ available: false });
    expect(capabilities.headers.get('cache-control')).toBe('no-store');
    for (const path of [`/v1/projects/${newId('project')}/deletion-plans`, `/v1/projects/${newId('project')}/deletions`, `/v1/project-deletions/${newId('resource')}/retry`]) {
      expect((await app.request(path, { method: 'POST', headers, body: '{}' })).status).toBe(404);
    }
    expect(() => createProvisioningModule({ ...deps, deletion: { intents: f.intents, owners: f.external.owners.slice(1) } })).toThrow();
    const complete = createProvisioningModule({ ...deps, deletion: { intents: f.intents, owners: f.external.owners } });
    expect(complete.api.deletions).toBeDefined(); expect(complete.http).toHaveLength(3); expect(complete.workers).toHaveLength(2); expect(complete.startupTasks).toHaveLength(2);
  });
});
