import { afterEach, describe, expect, test } from 'bun:test';
import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { managedModuleFixture } from './managedModuleFixture';

const available = await testDatabaseAvailable(), fixtures: Awaited<ReturnType<typeof managedModuleFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.tdb.drop(); });
async function setup() { const f = await managedModuleFixture(); fixtures.push(f); return f; }

describe.skipIf(!available)('受管镜像模块装配', () => {
  test('不受管底座和缺失网络隔离阻断实际构建意图', async () => {
    const f = await setup(), image = await f.image();
    const input = CreateRuntimeImageRevisionSchema.parse({ source: { kind: 'source', repositoryBindingId: f.project, ref: 'main', usage: 'task', architecture: 'linux/amd64' } });
    f.base('foreign.example/task:v1');
    await expect(f.api.createRevision(f.developer, f.project, image.id, input)).rejects.toThrow('不在受管仓库');
    expect(f.registry.calls).toEqual([]);
    f.base('registry.internal:5000/platform/task:v1');
    const revision = await f.api.createRevision(f.developer, f.project, image.id, input);
    const build = await f.api.startBuild(f.developer, f.project, image.id, { revisionId: revision.id, requestKey: 'isolated' });
    f.isolate(false); await f.api.runBuild(build.id);
    expect(f.resources.size).toBe(0); expect(f.issued).toEqual([]);
    expect((await f.uow.read.builds.get(build.id))?.resourcePlan).toBeUndefined();
    expect(await f.api.getBuild(f.developer, f.project, image.id, build.id)).toMatchObject({ unknown: true });
    await f.api.cancelBuild(f.developer, f.project, image.id, build.id, 'cancel');
    await f.api.runBuild(build.id);
    expect(await f.uow.read.builds.activeCount()).toBe(0);
  });

  test('源码固定提交及实际底座摘要，持久构建意图按隔离状态签发凭据，取消后撤销', async () => {
    const f = await setup(), image = await f.image();
    const revision = await f.api.createRevision(f.developer, f.project, image.id, CreateRuntimeImageRevisionSchema.parse({ source: { kind: 'source', repositoryBindingId: f.project, ref: 'main', usage: 'task', architecture: 'linux/amd64' } }));
    expect(revision).toMatchObject({ commitSha: 'b'.repeat(40), baseImage: `registry.internal:5000/platform/task@${f.registry.digest}` });
    expect(f.reads).toEqual([`${'b'.repeat(40)}/Dockerfile`]);
    const build = await f.api.startBuild(f.developer, f.project, image.id, { revisionId: revision.id, requestKey: 'build' });
    await f.api.runBuild(build.id);
    const saved = (await f.uow.read.builds.get(build.id))!;
    expect(saved.resourcePlan).toMatchObject({ buildId: build.id, executionEpoch: 1 });
    expect(f.resources.get(saved.resourceId!)?.desired).toBe('present');
    const identity = { recordId: saved.resourceId!, buildId: build.id, executionEpoch: 1 };
    f.isolate(false);
    await expect(f.imageBuildSecretValues(identity)).rejects.toThrow('isolation'); expect(f.issued).toEqual([]);
    f.isolate(true);
    expect(await f.imageBuildSecretValues(identity)).toMatchObject({ 'git-token': 'git-secret' });
    expect((await f.uow.read.builds.get(build.id))?.gitCredentialIds).toEqual(['git-1']);
    await f.api.cancelBuild(f.developer, f.project, image.id, build.id, 'cancel');
    await expect(f.imageBuildSecretValues(identity)).rejects.toThrow('构建已结束');
    await f.api.runBuild(build.id);
    expect(f.resources.get(saved.resourceId!)?.desired).toBe('absent');
    expect(f.revoked).toEqual(['git-1']);
    expect(await f.api.getBuild(f.developer, f.project, image.id, build.id)).toMatchObject({ state: 'cancelled' });
    expect(await f.uow.read.builds.activeCount()).toBe(0);
  });

  test('已有服务镜像按授权仓库固定摘要并登记版本，不声明构建资源', async () => {
    const f = await setup(), image = await f.image();
    const revision = await f.api.createRevision(f.developer, f.project, image.id, CreateRuntimeImageRevisionSchema.parse({ source: { kind: 'existing', reference: `runtime/projects/${f.project}/tool:v1`, usage: 'service', architecture: 'linux/amd64' } }));
    expect(revision.source).toMatchObject({ reference: `registry.internal:5000/runtime/projects/${f.project}/tool@${f.registry.digest}` });
    const build = await f.api.startBuild(f.developer, f.project, image.id, { revisionId: revision.id, requestKey: 'import' });
    await f.api.runBuild(build.id);
    expect(await f.api.getBuild(f.developer, f.project, image.id, build.id)).toMatchObject({ state: 'succeeded' });
    expect(await f.api.listVersions(f.developer, f.project, image.id, { limit: 10 })).toMatchObject([{ digest: f.registry.digest }]);
    expect(f.resources.size).toBe(0); expect(f.issued).toEqual([]);
    await expect(f.api.createRevision(f.developer, f.project, image.id, CreateRuntimeImageRevisionSchema.parse({ source: { ...revision.source, reference: 'runtime/projects/foreign/tool:v1' } }))).rejects.toThrow('前缀');
  });
});
