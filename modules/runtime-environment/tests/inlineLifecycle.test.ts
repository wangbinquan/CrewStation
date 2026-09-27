import { afterEach, describe, expect, test } from 'bun:test';
import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { buildExecutorFixture } from './buildExecutorFixture';

const available = await testDatabaseAvailable(), fixtures: RuntimeImageFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.tdb.drop(); });
const source = { kind: 'inline', usage: 'task', architecture: 'linux/amd64', dockerfileContent: 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}', files: [{ path: 'file', contentBase64: 'AA==' }] };

describe.skipIf(!available)('无仓库构建的持久准入与资源生命周期', () => {
  test('管理员原子保存、同键重放、固定修订；业务身份和非法输入不能写入', async () => {
    const f = await runtimeImageFixture(); fixtures.push(f);
    const path = '/v1/admin/runtime-image-catalog/setup', body = { name: 'no repository', description: '', requestKey: 'inline-setup', recipe: { source } };
    expect((await f.app.request(path, { method: 'POST', body: JSON.stringify(body) })).status).toBe(401);
    expect((await f.app.request(path, { method: 'POST', headers: f.headers(f.developer), body: JSON.stringify(body) })).status).toBe(403);
    const send = (value: unknown) => f.app.request(path, { method: 'POST', headers: f.headers(f.admin), body: JSON.stringify(value) });
    expect((await send({ ...body, recipe: { source: { ...source, files: [{ path: '../escape', contentBase64: '' }] } } })).status).toBe(400);
    const first = await send(body); expect(first.status).toBe(201); const saved = await first.json();
    expect(saved.image).not.toHaveProperty('projectId'); expect(saved.revision).not.toHaveProperty('sourceProjectId');
    expect(saved.revision.source).toMatchObject(source); expect(await (await send(body)).json()).toEqual(saved);
    const changed = await f.api.createRevision(f.admin, undefined, saved.image.id, CreateRuntimeImageRevisionSchema.parse({ source: { ...source, files: [{ path: 'file', contentBase64: 'AQ==' }] } }));
    expect(changed.recipeDigest).not.toBe(saved.revision.recipeDigest);
    const build = await f.api.startBuild(f.admin, undefined, saved.image.id, { revisionId: saved.revision.id, requestKey: 'build' });
    expect(build.resourceId).toBeDefined(); expect(build).not.toHaveProperty('sourceProjectId');
    expect(build.revisionId).toBe(saved.revision.id);
    expect(await f.api.startBuild(f.admin, undefined, saved.image.id, { revisionId: saved.revision.id, requestKey: 'build' })).toEqual(build);
  });

  test('直接编写构建必须观测原 Pod 和物理回收；取消后不登记晚到产物', async () => {
    const driver = buildExecutorFixture(), f = await runtimeImageFixture(driver.executor); fixtures.push(f);
    const image = await f.api.createImage(f.admin, undefined, { name: 'inline lifecycle', description: '' });
    const revision = await f.api.createRevision(f.admin, undefined, image.id, CreateRuntimeImageRevisionSchema.parse({ source }));
    const build = await f.api.startBuild(f.admin, undefined, image.id, { revisionId: revision.id, requestKey: 'first' });
    await f.api.runBuild(build.id); expect((await f.api.getBuild(f.admin, undefined, image.id, build.id)).state).toBe('building');
    driver.state('succeeded'); await f.api.runBuild(build.id);
    expect(await f.api.listVersions(f.admin, undefined, image.id, { limit: 10 })).toEqual([]);
    driver.stopped(true); await f.api.runBuild(build.id);
    expect((await f.api.getBuild(f.admin, undefined, image.id, build.id)).state).toBe('succeeded');
    expect(await f.api.listVersions(f.admin, undefined, image.id, { limit: 10 })).toHaveLength(1);
    const cancelled = await f.api.startBuild(f.admin, undefined, image.id, { revisionId: revision.id, requestKey: 'cancelled' });
    await f.api.cancelBuild(f.admin, undefined, image.id, cancelled.id, 'stop'); await f.api.runBuild(cancelled.id);
    expect((await f.api.getBuild(f.admin, undefined, image.id, cancelled.id)).state).toBe('cancelled');
    expect(await f.api.listVersions(f.admin, undefined, image.id, { limit: 10 })).toHaveLength(1);
  });
});
