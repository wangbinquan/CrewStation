import { afterEach, describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { claimJobs } from '@crewstation/queue';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { REBUILD_JOB_KIND } from '../ports/rebuilds';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
describe.skipIf(!available)('重建作业重试与补偿', () => {
  test('新 Pod 长时间不能连接明确失败并保卷，已连接环境不被启动超时误停', async () => {
    f = await rebuildFixture(); const input = await f.request(); await f.runtime.api.requestRebuild(f.projectId, input); await f.run();
    const pending = (await f.runtime.api.getEnvironment(f.env.id))!;
    // 实机 CPU 不足导致恢复容器一直 Pending，超时原因必须保留调度证据。
    expect(pending.message).not.toContain('已挂载');
    await f.k8s.mergePatch(Resources.Pod!, pending.podName, f.env.namespace, { status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: 'Insufficient cpu' }] } });
    f.advance(5 * 60_000); await f.runtime.api.reconcile(); await f.run();
    expect(await f.runtime.api.getRebuild(f.env.id)).toMatchObject({ state: 'failed', message: expect.stringContaining('超过 5 分钟') });
    expect((await f.runtime.api.getRebuild(f.env.id))?.message).toContain('Insufficient cpu');
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toBeDefined();
    const retry = await f.request(); await f.runtime.api.requestRebuild(f.projectId, retry); await f.run();
    const record = (await f.uow.read.rebuilds.get(retry.requestId))!;
    const secret = (await f.k8s.get(Resources.Secret!, record.secretName, record.namespace))!;
    expect(await f.runtime.api.onRunnerConnected(f.env.id, (secret.stringData as Record<string, string>).CS_RUNNER_TOKEN!)).toBe(true);
    f.advance(5 * 60_000); await f.runtime.api.reconcile(); expect((await f.runtime.api.getEnvironment(f.env.id))?.state).toBe('running');
  });
  for (const kind of ['Secret', 'Pod'] as const) test(`${kind} 创建成功但响应丢失，下一次采用同一实例、令牌和工作卷`, async () => {
    f = await rebuildFixture(); const input = await f.request(); await f.runtime.api.requestRebuild(f.projectId, input);
    const create = f.k8s.create; let count = 0;
    f.k8s.create = async (object) => { const result = await create(object); if (object.kind === kind && ++count === 1) throw new Error('create response lost'); return result; };
    const volume = structuredClone(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace));
    await f.run(); expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('replacing');
    const objects = structuredClone([...f.k8s.objects.values()].filter((object) => object.kind === kind));
    await f.nextAttempt();
    expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('starting'); expect(count).toBe(1);
    expect([...f.k8s.objects.values()].filter((object) => object.kind === kind)).toEqual(objects);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toEqual(volume);
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
  });

  test('创建失败只清理本次资源，保卷释放一次配额，旧请求回放不重建', async () => {
    f = await rebuildFixture(); const input = await f.request(); await f.runtime.api.requestRebuild(f.projectId, input);
    const create = f.k8s.create;
    f.k8s.create = async (object) => { if (object.kind === 'Pod') throw precondition('集群暂不接受所选资源'); return create(object); };
    await f.run(); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    await f.nextAttempt();
    expect(await f.runtime.api.getEnvironment(f.env.id)).toMatchObject({ state: 'failed' });
    expect(await f.runtime.api.getRebuild(f.env.id)).toMatchObject({ state: 'failed' });
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    expect([...f.k8s.objects.values()].filter((object) => object.kind === 'Secret')).toEqual([]);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, f.env.pvcName, f.env.namespace)).toBeDefined();
    expect((await f.runtime.api.requestRebuild(f.projectId, input)).state).toBe('failed');
    await f.runtime.api.reconcile(); await f.run(); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    f.k8s.create = create; const retry = await f.request(); await f.runtime.api.requestRebuild(f.projectId, retry); await f.run();
    expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('starting');
  });

  test('启动 Pod 失败先持久化补偿，清理连接故障超出重试仍由对账接续', async () => {
    f = await rebuildFixture(); const input = await f.request(); await f.runtime.api.requestRebuild(f.projectId, input); await f.run();
    const env = (await f.uow.read.environments.getById(f.env.id))!;
    await f.k8s.mergePatch(Resources.Pod!, env.podName, env.namespace, { status: { phase: 'Failed', reason: 'OOMKilled' } });
    await f.runtime.api.reconcile();
    const remove = f.k8s.delete; f.k8s.delete = async () => { throw new Error('delete temporarily unavailable'); };
    await f.tdb.db.execute(sql`UPDATE platform_infra.jobs SET max_attempts = 1 WHERE state = 'pending'`);
    await f.run(); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
    const jobs = await f.tdb.db.execute(sql`SELECT state FROM platform_infra.jobs ORDER BY id DESC LIMIT 1`); expect([...jobs].map((row) => row.state)).toEqual(['dead']);
    f.k8s.delete = remove; await f.runtime.api.reconcile(); await f.run();
    expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('failed'); expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(0);
    expect(await f.k8s.get(Resources.PersistentVolumeClaim!, env.pvcName, env.namespace)).toBeDefined();
  });

  test('创建期间租约被接管，旧执行不能提交就绪；新执行接续已创建 Pod', async () => {
    f = await rebuildFixture(); const input = await f.request(); await f.runtime.api.requestRebuild(f.projectId, input);
    const { tdb, k8s } = f, create = k8s.create; let stolen = false;
    k8s.create = async (object) => {
      const pod = await create(object);
      if (object.kind === 'Pod' && !stolen) {
        stolen = true;
        await tdb.db.execute(sql`UPDATE platform_infra.jobs SET lease_until = now() - interval '1 second' WHERE state = 'running'`);
        expect(await claimJobs(tdb.db, [REBUILD_JOB_KIND], 'replacement-controller', 0, 1)).toHaveLength(1);
      }
      return pod;
    };
    await f.run(); expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('replacing');
    const podUid = [...k8s.objects.values()].find((object) => object.kind === 'Pod')!.metadata.uid;
    await f.nextAttempt(); expect((await f.runtime.api.getRebuild(f.env.id))?.state).toBe('starting');
    expect([...k8s.objects.values()].find((object) => object.kind === 'Pod')!.metadata.uid).toBe(podUid);
    expect(await f.runtime.api.runningTaskCount(f.projectId)).toBe(1);
  });
});
