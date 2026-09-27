import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { CreateRuntimeImageRevisionSchema, IDENTITY_HEADERS } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { digest, runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
let f: RuntimeImageFixture;
beforeAll(async () => { if (available) f = await runtimeImageFixture(); });
afterAll(async () => { await f?.tdb.drop(); });

describe.skipIf(!available)('运行镜像目录真实数据库与 HTTP', () => {
  test('固定源码 SHA 与镜像摘要，修订只追加；目录修改使用乐观锁', async () => {
    const image = await f.image(), first = await f.revision(image.id), second = await f.revision(image.id);
    expect(first.commitSha).toBe('b'.repeat(40));
    expect(second).toMatchObject({ revision: 2, recipeDigest: first.recipeDigest });
    const imported = await f.api.createRevision(f.admin, f.project, image.id, CreateRuntimeImageRevisionSchema.parse({ source: { kind: 'existing', reference: 'registry.test/project/tool:latest', architecture: 'linux/amd64', usage: 'service' } }));
    expect(imported.source).toMatchObject({ reference: `registry.test/project/tool@${digest}` });
    expect(await f.api.updateImage(f.admin, f.project, image.id, { expectedRevision: 1, name: 'renamed' })).toMatchObject({ name: 'renamed', revision: 2 });
    await expect(f.api.updateImage(f.admin, f.project, image.id, { expectedRevision: 1, name: 'stale' })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await f.api.listRevisions(f.admin, f.project, image.id, { limit: 2 })).map((r) => r.revision)).toEqual([3, 2]);
    expect((await f.api.listRevisions(f.admin, f.project, image.id, { limit: 2, before: second.id }))[0]).toEqual(first);
  });
  test('共享只开放目录与版本，外项目不能读取配方、Secret 引用与构建日志', async () => {
    const image = await f.image();
    await expect(f.api.getImage(f.developer, f.otherProject, image.id)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.api.shareImage(f.developer, f.project, image.id, 'shared', 1)).rejects.toMatchObject({ kind: 'forbidden' });
    await f.api.shareImage(f.admin, f.project, image.id, 'shared', 1);
    expect(await f.api.getImage(f.developer, f.otherProject, image.id)).toMatchObject({ defaultVisible: true });
    expect((await f.api.listImages(f.developer, f.otherProject, { limit: 100 })).some((i) => i.id === image.id)).toBe(true);
    expect(await f.api.listVersions(f.developer, f.otherProject, image.id, { limit: 10 })).toEqual([]);
    await expect(f.api.listRevisions(f.developer, f.otherProject, image.id, { limit: 10 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.listBuilds(f.developer, f.otherProject, image.id, { limit: 10 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.getImage(f.outsider, f.project, image.id)).rejects.toMatchObject({ kind: 'forbidden' });
  });
  test('管理目录受管理员保护且保持旧推送信息接口独立', async () => {
    const image = await f.image();
    const url = '/v1/admin/runtime-image-catalog?limit=100';
    expect((await f.app.request(url, { headers: f.headers(f.developer) })).status).toBe(403);
    const response = await f.app.request(url, { headers: f.headers(f.admin) });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json() as { items: Array<{ id: string }> };
    expect(body.items.some((entry) => entry.id === image.id)).toBe(true);
  });
  test('服务身份、tester、未知字段与跨项目请求不能触发源码解析', async () => {
    const image = await f.image(), root = `/v1/projects/${f.project}/runtime-images`, initial = f.prepares();
    const post = (path: string, body: unknown, headers: Record<string, string>) => f.app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await post(root, { name: 'forged', projectId: f.otherProject }, f.headers(f.developer))).status).toBe(400);
    expect((await post(root, { name: 'tester' }, f.headers(f.tester))).status).toBe(403);
    expect((await post(root, { name: 'service' }, { [IDENTITY_HEADERS.sourceService]: 'demo/service', 'Content-Type': 'application/json' })).status).toBe(403);
    expect((await post(root, { name: 'anonymous' }, { 'Content-Type': 'application/json' })).status).toBe(401);
    const source = { source: { kind: 'existing', reference: 'registry.test/project/tool:v1', architecture: 'linux/amd64', usage: 'task' } };
    expect((await post(`${root}/${image.id}/revisions`, source, f.headers(f.tester))).status).toBe(403);
    expect((await post(`/v1/projects/${f.otherProject}/runtime-images/${image.id}/revisions`, source, f.headers(f.developer))).status).toBe(403);
    expect(f.prepares()).toBe(initial);
    expect((await post(root, { name: 'not-platform-admin' }, f.headers(f.developer))).status).toBe(403);
    const created = await post(root, { name: 'http-created' }, f.headers(f.admin));
    expect(created.status).toBe(201);
    const id = (await created.json() as { id: string }).id;
    const got = await f.app.request(`${root}/${id}`, { headers: f.headers(f.developer) });
    expect(got.headers.get('Cache-Control')).toBe('no-store');
    expect(got.status).toBe(200);
  });
});
