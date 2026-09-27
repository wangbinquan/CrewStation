import { afterEach, describe, expect, test } from 'bun:test';
import { CreateRuntimeImageSetupSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion } from './versionFixture';

const available = await testDatabaseAvailable(), root = '/v1/admin/runtime-image-catalog';
let f: RuntimeImageFixture | undefined;
afterEach(async () => { await f?.tdb.drop(); f = undefined; });
const setup = () => CreateRuntimeImageSetupSchema.parse({ name: 'Global tools', description: 'Python', requestKey: newResourceId(), recipe: { source: { kind: 'existing', reference: 'registry.test/tools:v1', architecture: 'linux/amd64', usage: 'task' } } });

describe.skipIf(!available)('平台镜像目录与业务授权', () => {
  test('业务目录搜索在授权和分页内匹配名称或用途，不返回不可见镜像', async () => {
    f = await runtimeImageFixture();
    const match = await f.api.createImage(f.admin, f.project, { name: 'Toolbox', description: 'Python build tools' });
    const newer = await f.api.createImage(f.admin, f.project, { name: 'Node tools', description: '' });
    await f.api.createImage(f.admin, undefined, { name: 'Python private', description: '' });
    const read = async (query: string) => {
      const response = await f!.app.request(`/v1/projects/${f!.project}/runtime-images?${query}`, { headers: f!.headers(f!.developer) });
      expect(response.status).toBe(200);
      return (await response.json()).items.map((image: { id: string }) => image.id);
    };
    expect(await read('limit=1')).toEqual([newer.id]);
    expect(await read('search=PYTHON&limit=1')).toEqual([match.id]);
    expect(await read(`search=toolbox&limit=1&before=${newer.id}`)).toEqual([match.id]);
    expect(await read('search=missing&limit=1')).toEqual([]);
    await f.api.saveProjectImagePolicy(f.admin, f.project, { expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds: [newer.id] } });
    expect(await read('search=python&limit=1')).toEqual([]);
  });

  test('平台新增不带项目、默认不开放；业务覆盖优先，搜索在分页前且管理员写路径不可绕过', async () => {
    f = await runtimeImageFixture();
    const input = setup(), send = () => f!.app.request(`${root}/setup`, { method: 'POST', headers: f!.headers(f!.admin), body: JSON.stringify(input) });
    const response = await send(); expect(response.status).toBe(201);
    const created = await response.json(), id = created.image.id;
    expect(created.image).not.toHaveProperty('projectId'); expect(created.image).not.toHaveProperty('scope');
    expect(created.image.defaultVisible).toBe(false); expect(created.revision.sourceProjectId).toBeUndefined();
    expect(await (await send()).json()).toEqual(created);
    expect(await f.api.listImages(f.developer, f.project, { limit: 20 })).toEqual([]);
    expect((await f.app.request(root, { headers: f.headers(f.developer) })).status).toBe(403);
    expect((await f.app.request(`${root}/${id}`, { method: 'PATCH', headers: f.headers(f.developer), body: JSON.stringify({ name: 'bad', expectedRevision: 1 }) })).status).toBe(403);
    expect((await f.app.request(`/v1/projects/${f.project}/runtime-images`, { method: 'POST', headers: f.headers(f.developer), body: JSON.stringify({ name: 'bypass', description: '' }) })).status).toBe(403);
    await f.api.saveProjectImagePolicy(f.admin, f.project, { expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds: [id] } });
    expect((await f.api.listImages(f.developer, f.project, { limit: 20 })).map((i) => i.id)).toEqual([id]);
    await f.api.updateImage(f.admin, undefined, id, { expectedRevision: 1, defaultVisible: true });
    await f.api.saveProjectImagePolicy(f.admin, f.otherProject, { expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds: [] } });
    expect(await f.api.listImages(f.developer, f.otherProject, { limit: 20 })).toEqual([]);
    const grants = await (await f.app.request(`${root}/${id}/grants`, { headers: f.headers(f.admin) })).json();
    expect(grants).toMatchObject({ defaultVisible: true, retainedProjectIds: [], overrides: expect.arrayContaining([{ projectId: f.project, allowed: true }, { projectId: f.otherProject, allowed: false }]) });
    await f.api.createImage(f.admin, undefined, { name: 'unrelated newer', description: '' });
    expect((await (await f.app.request(`${root}?search=python&limit=1`, { headers: f.headers(f.admin) })).json()).items.map((i: { id: string }) => i.id)).toEqual([id]);
    const build = await f.api.startBuild(f.admin, undefined, id, { revisionId: created.revision.id, requestKey: 'global-build' });
    expect(build.projectId).toBeUndefined(); expect(build.sourceProjectId).toBeUndefined();
  });

  test('管理员跨业务看版本和验证，启动验证仍要求消费业务；业务不能读取其他业务验证', async () => {
    f = await runtimeImageFixture(); const version = await builtVersion(f);
    const path = `${root}/${version.imageId}/versions/${version.id}`;
    const get = (suffix: string) => f!.app.request(path + suffix, { headers: f!.headers(f!.admin) });
    expect((await get('')).status).toBe(200); expect((await get('')).headers.get('Cache-Control')).toBe('no-store');
    expect(await (await get('')).json()).not.toHaveProperty('projectId');
    const input = { requestKey: 'validate', target: { usage: 'task' } };
    const send = (body: unknown) => f!.app.request(`${path}/validations`, { method: 'POST', headers: f!.headers(f!.admin), body: JSON.stringify(body) });
    expect((await send(input)).status).toBe(400);
    expect((await send({ ...input, projectId: f.otherProject })).status).toBe(404);
    const response = await send({ ...input, projectId: f.project }); expect(response.status).toBe(202);
    const validation = await response.json(); expect(validation.projectId).toBe(f.project);
    await f.api.updateImage(f.admin, undefined, version.imageId, { expectedRevision: 1, defaultVisible: true });
    expect((await f.api.listValidations(f.developer, f.otherProject, version.id))).toEqual([]);
    expect((await f.api.versionReferences(f.admin, f.otherProject, version.id)).items).toEqual([]);
    expect((await f.api.versionReferences(f.admin, undefined, version.id)).items).toHaveLength(1);
    expect((await get('/validations')).status).toBe(200);
    expect((await (await get('/validations')).json()).items).toHaveLength(1);
    expect((await f.app.request(path, { headers: f.headers(f.developer) })).status).toBe(403);
    expect((await f.app.request(`${root}/${newResourceId()}/versions/${version.id}`, { headers: f.headers(f.admin) })).status).toBe(404);
    const cancel = await f.app.request(`${path}/validations/${validation.id}/cancel`, { method: 'POST', headers: f.headers(f.admin), body: JSON.stringify({ requestKey: 'cancel' }) });
    expect(cancel.status).toBe(202); expect((await cancel.json()).state).toBe('cancelling');
  });
});
