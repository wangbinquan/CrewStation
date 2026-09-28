import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { readAdminCatalog } from '../adapters/persistence/catalogSummary';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion, passedValidation } from './versionFixture';

const available = await testDatabaseAvailable();
let f: RuntimeImageFixture | undefined;
afterEach(async () => { await f?.tdb.drop(); f = undefined; });

describe.skipIf(!available)('平台目录摘要', () => {
  test('分页批量读取最新记录，空值完整，响应不泄露执行内部信息', async () => {
    f = await runtimeImageFixture();
    expect(await readAdminCatalog(f.tdb.db, { limit: 30 })).toEqual([]);
    const empty = await f.image();
    expect((await readAdminCatalog(f.tdb.db, { limit: 30 }))[0]!.summary).toEqual({ version: null, build: null, validation: null });
    const version = await builtVersion(f), validation = await passedValidation(f, version.id);
    const select = spyOn(f.tdb.db, 'select'), distinct = spyOn(f.tdb.db, 'selectDistinctOn');
    let items;
    try {
      items = await readAdminCatalog(f.tdb.db, { limit: 30 });
      // 浏览器不再逐行请求，同时数据库也不能随行数产生 N+1 查询。
      expect(select).toHaveBeenCalledTimes(1); expect(distinct).toHaveBeenCalledTimes(3);
    } finally { select.mockRestore(); distinct.mockRestore(); }
    expect(items.find((i) => i.id === empty.id)!.summary).toEqual({ version: null, build: null, validation: null });
    const summary = items.find((i) => i.id === version.imageId)!.summary;
    expect(summary.version).toEqual({ id: version.id, digest: version.digest, architecture: version.architecture, state: 'available' });
    expect(summary.validation).toEqual({ id: validation.id, state: 'passed', usage: 'task' });
    expect(Object.keys(summary.build!).sort()).toEqual(['id', 'state', 'updatedAt']);
    expect(summary.build).toMatchObject({ id: version.buildId, state: 'succeeded' });
    const response = await f.app.request('/v1/admin/runtime-image-catalog?limit=1', { headers: f.headers(f.admin) });
    expect(response.status).toBe(200); expect((await response.json()).items[0].summary).toEqual(summary);
    expect((await f.api.listImages(f.developer, f.project, { limit: 30 }))[0]).not.toHaveProperty('summary');
  });

  test('新版本不能沿用旧版本验证，最新失败构建和验证立即反映在摘要', async () => {
    f = await runtimeImageFixture(); const version = await builtVersion(f);
    await passedValidation(f, version.id);
    const check = await f.api.startValidation(f.developer, f.project, version.id, { requestKey: newResourceId(), target: { usage: 'task' } });
    await f.uow.run(async (s) => { await s.validations.update({ ...(await s.validations.get(check.id))!, state: 'failed' }); });
    const read = async () => (await readAdminCatalog(f!.tdb.db, { limit: 30 }))[0]!.summary;
    expect((await read()).validation).toEqual({ id: check.id, state: 'failed', usage: 'task' });
    const build = await f.api.startBuild(f.admin, f.project, version.imageId, { revisionId: version.revisionId, requestKey: newResourceId() });
    await f.uow.run(async (s) => { await s.builds.update({ ...(await s.builds.get(build.id))!, state: 'failed', error: 'build failed' }); });
    expect((await read()).build).toMatchObject({ id: build.id, state: 'failed', error: 'build failed' });
    const next = { ...version, id: newResourceId(), buildId: build.id };
    await f.uow.run(async (s) => { await s.versions.insert(next); });
    expect((await read()).version?.id).toBe(next.id); expect((await read()).validation).toBeNull();
    expect(await readAdminCatalog(f.tdb.db, { limit: 30, search: 'does-not-exist' })).toEqual([]);
    expect(await readAdminCatalog(f.tdb.db, { limit: 30, before: version.imageId })).toEqual([]);
  });
});
