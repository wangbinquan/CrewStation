import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion, passedValidation } from './versionFixture';

const available = await testDatabaseAvailable();
let f: RuntimeImageFixture;
beforeAll(async () => { if (available) f = await runtimeImageFixture(); });
afterAll(async () => { await f?.tdb.drop(); });

describe.skipIf(!available)('开发镜像策略', () => {
  test('HTTP 保存默认及允许集合，CAS 防覆盖，引用阻断回收，清空后释放策略引用', async () => {
    const version = await builtVersion(f), root = `/v1/projects/${f.project}/development-runtime-images`;
    const put = (body: unknown) => f.app.request(root, { method: 'PUT', headers: f.headers(f.developer), body: JSON.stringify(body) });
    expect(await (await f.app.request(root, { headers: f.headers(f.developer) })).json()).toMatchObject({ revision: 0, developmentTask: {}, developmentAgents: [] });
    const input = { expectedRevision: 0, developmentTask: { runtimeImageVersionId: version.id, allowedRuntimeImageVersionIds: [version.id] }, developmentAgents: [] };
    expect((await put(input)).status).toBe(412);
    await passedValidation(f, version.id);
    const result = await put(input);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ revision: 1, developmentTask: input.developmentTask });
    expect((await put({ ...input, unrecognized: true })).status).toBe(400);
    expect((await put(input)).status).toBe(409);
    expect((await f.api.versionReferences(f.developer, f.project, version.id)).items).toContainEqual(expect.objectContaining({ ownerType: 'development-config', state: 'confirmed' }));
    await f.api.disableVersion(f.admin, f.project, version.id);
    await expect(f.api.retireVersion(f.admin, f.project, version.id)).rejects.toMatchObject({ kind: 'conflict' });
    expect((await put({ expectedRevision: 1, developmentTask: {}, developmentAgents: [] })).status).toBe(200);
    expect(await f.api.retireVersion(f.admin, f.project, version.id)).toMatchObject({ version: { state: 'retired' } });
  });

  test('配置受项目写权限保护，不能用其他项目私有镜像', async () => {
    const version = await builtVersion(f);
    const input = { expectedRevision: 0, developmentTask: { runtimeImageVersionId: version.id }, developmentAgents: [] };
    await expect(f.api.saveDevelopmentImages(f.tester, f.project, input)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.saveDevelopmentImages(f.developer, f.otherProject, input)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.api.getDevelopmentImages(f.outsider, f.project)).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
