import { afterEach, describe, expect, test } from 'bun:test';
import { TasksSpecSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { releaseImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable(), cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const fixture = async (ledger = false) => { const f = await releaseImageFixture(ledger); cleanups.push(f.close); return f; };
describe.skipIf(!available)('服务运行镜像发布', () => {
  test('已有镜像跳过构建，固定 SHA 的 Manifest 和所选 digest 同时用于迁移与部署', async () => {
    const f = await fixture(), rel = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
    await f.runtime.api.runPipelineStep(rel.id);
    expect(f.state.reads).toEqual(['main', 'c'.repeat(40)]);
    expect(f.state.builds).toEqual([]);
    expect(await f.runtime.api.getRelease(f.actor, rel.id)).toMatchObject({ status: 'migrating', image: f.snapshot.image, message: '使用已有镜像' });
    expect(f.state.reservations).toEqual([expect.objectContaining({ versionId: f.snapshot.versionId, service: expect.objectContaining({ probes: { readiness: { path: '/ready', initialDelaySeconds: 0, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: 3 } } }) })]);
    expect(f.state.confirmations).toEqual([[f.snapshot.versionId, rel.id]]);
    expect(f.state.migrations).toEqual([expect.objectContaining({ image: f.snapshot.image, command: ['app', 'migrate'] })]);
    f.state.manifest.spec.service.command = ['unexpected-new-command'];
    await f.runtime.api.runPipelineStep(rel.id);
    expect(f.state.deployed).toEqual([expect.objectContaining({ image: f.snapshot.image, manifest: expect.objectContaining({ spec: expect.objectContaining({ service: expect.objectContaining({ command: ['app'] }) }) }) })]);
    expect(f.state.reads).toEqual(['main', 'c'.repeat(40)]);
    expect((await f.uow.read.releases.getById(rel.id))?.pipeline.runtimeImage).toEqual(f.snapshot);
  });

  test('资源台账引用模式仅声明所选镜像的迁移 Job，不生成虚假构建 Job', async () => {
    const f = await fixture(true), rel = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
    await f.runtime.api.runPipelineStep(rel.id);
    expect(await f.resources.api.list({ kind: 'build-job' })).toEqual([]);
    const migrations = await f.resources.api.list({ kind: 'migration-job' });
    expect(migrations).toHaveLength(1);
    expect((await f.resources.api.get(migrations[0]!.id))?.spec['job']).toMatchObject({ image: f.snapshot.image, command: ['app', 'migrate'] });
    expect((await f.runtime.api.getRelease(f.actor, rel.id)).status).toBe('migrating');
  });

  test('服务构建前固定并确认发布任务允许集，失败不能进入迁移', async () => {
    const f = await fixture(), versionId = newResourceId();
    f.state.tasks = TasksSpecSchema.parse({ taskProfileId: newResourceId(), runtimeImageVersionId: versionId });
    const rel = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
    await f.runtime.api.runPipelineStep(rel.id);
    expect(f.state.taskReservations).toEqual([expect.objectContaining({ projectId: f.projectId, releaseId: rel.id, tasks: expect.objectContaining({ runtimeImageVersionId: versionId }) })]);
    expect(f.state.taskConfirmations).toEqual([[{ versionId, ownerId: `${rel.id}:task` }]]);
    expect((await f.uow.read.releases.getById(rel.id))?.pipeline.runtimeImageSelections).toEqual([{ versionId, ownerId: `${rel.id}:task` }]);
    const failed = await fixture(); failed.state.tasks = f.state.tasks; failed.state.refuseTaskImages = true;
    const rejected = await failed.runtime.api.publish(failed.actor, failed.serviceId, { branch: 'main', version: 'patch' });
    await failed.runtime.api.runPipelineStep(rejected.id);
    expect((await failed.runtime.api.getRelease(failed.actor, rejected.id)).status).toBe('failed');
    expect([failed.state.builds, failed.state.migrations, failed.state.deployed, failed.state.taskConfirmations]).toEqual([[], [], [], []]);
  });

  test('不兼容镜像拒绝后不执行构建、迁移或部署', async () => {
    const f = await fixture(); f.state.refuse = true;
    const rel = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
    await f.runtime.api.runPipelineStep(rel.id);
    expect((await f.runtime.api.getRelease(f.actor, rel.id)).status).toBe('failed');
    expect([f.state.builds, f.state.migrations, f.state.deployed, f.state.confirmations]).toEqual([[], [], [], []]);
  });
});
