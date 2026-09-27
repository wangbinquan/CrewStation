import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion, passedValidation } from './versionFixture';

const available = await testDatabaseAvailable();
let f: RuntimeImageFixture;
beforeAll(async () => { if (available) f = await runtimeImageFixture(); });
afterAll(async () => { await f?.tdb.drop(); });

describe.skipIf(!available)('运行镜像业务授权：真实数据库与 HTTP', () => {
  test('非管理员不能扩权，管理员显式开放后业务才能读取；不开放配方和构建日志', async () => {
    const image = await f.image(), url = `/v1/projects/${f.otherProject}/runtime-image-policy`;
    const input = { expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds: [image.id] } };
    const put = (admin: boolean) => f.app.request(url, { method: 'PUT', headers: f.headers(admin ? f.admin : f.developer), body: JSON.stringify(input) });
    await expect(f.api.getImage(f.developer, f.otherProject, image.id)).rejects.toMatchObject({ kind: 'not_found' });
    expect((await put(false)).status).toBe(403);
    const saved = await put(true);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ projectId: f.otherProject, revision: 1, policy: input.policy });
    expect(await f.api.getImage(f.developer, f.otherProject, image.id)).toMatchObject({ id: image.id });
    expect((await f.api.listImages(f.developer, f.otherProject, { limit: 1 })).map((i) => i.id)).toEqual([image.id]);
    await expect(f.api.listRevisions(f.developer, f.otherProject, image.id, { limit: 1 })).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.api.listBuilds(f.developer, f.otherProject, image.id, { limit: 1 })).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await put(true)).status).toBe(409);
    expect((await f.app.request(url, { headers: f.headers(f.outsider) })).status).toBe(403);
    const read = await f.app.request(url, { headers: f.headers(f.developer) });
    expect(read.status).toBe(200);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
  });

  test('受限空集合拒绝全部；授权在分页前过滤，直传版本 ID 与新执行不能绕过撤销', async () => {
    const version = await builtVersion(f);
    await passedValidation(f, version.id);
    const input = { requestedVersionId: version.id, selection: { allowedRuntimeImageVersionIds: [version.id] }, target: { usage: 'task' as const }, owner: { type: 'task' as const, id: newResourceId() } };
    const accepted = await f.api.reserveImage(f.developer, f.project, input);
    await f.api.saveProjectImagePolicy(f.admin, f.project, { expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds: [] } });
    expect(await f.api.listImages(f.developer, f.project, { limit: 100 })).toEqual([]);
    await expect(f.api.getVersion(f.developer, f.project, version.id)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.api.reserveImage(f.developer, f.project, { ...input, owner: { type: 'task', id: newResourceId() } })).rejects.toMatchObject({ kind: 'not_found' });
    expect(await f.api.reserveImage(f.developer, f.project, input)).toEqual(accepted);
    await expect(f.api.reserveImage(f.outsider, f.project, input)).rejects.toMatchObject({ kind: 'forbidden' });
    // 已运行任务的原引用仍保留；恢复复制必须来自本业务已存在的引用。
    await f.api.copyReference(f.project, version.id, input.owner, { type: 'task', id: 'resume' });
    expect((await f.uow.read.references.list(version.id)).length).toBe(2);
    await f.api.saveProjectImagePolicy(f.admin, f.project, { expectedRevision: 1, policy: { mode: 'restricted', allowedImageIds: [version.imageId] } });
    await f.image(); // 较新的未授权镜像不能挤掉第一页的授权镜像。
    expect((await f.api.listImages(f.developer, f.project, { limit: 1 })).map((i) => i.id)).toEqual([version.imageId]);
    expect(await f.api.listImages(f.developer, f.project, { limit: 1, before: version.imageId })).toEqual([]);
    await f.api.saveProjectImagePolicy(f.admin, f.project, { expectedRevision: 2, policy: { mode: 'inherit', allowedImageIds: [] } });
    expect((await f.api.listImages(f.developer, f.project, { limit: 100 })).length).toBeGreaterThan(1);
  });

  test('继承返回修订0；不存在、重复或继承模式夹带授权均拒绝且不写入', async () => {
    const project = newResourceId();
    expect(await f.api.getProjectImagePolicy(f.admin, project)).toMatchObject({ revision: 0, policy: { mode: 'inherit', allowedImageIds: [] } });
    const unknown = newResourceId(), url = `/v1/projects/${project}/runtime-image-policy`;
    for (const policy of [{ mode: 'restricted', allowedImageIds: [unknown] }, { mode: 'restricted', allowedImageIds: [unknown, unknown] }, { mode: 'inherit', allowedImageIds: [unknown] }]) {
      const result = await f.app.request(url, { method: 'PUT', headers: f.headers(f.admin), body: JSON.stringify({ expectedRevision: 0, policy }) });
      expect(result.status).toBe(400);
    }
    expect((await f.api.getProjectImagePolicy(f.admin, project)).revision).toBe(0);
  });

  test('并发授权只有一个预期修订能提交，落库结果与成功回执一致', async () => {
    const project = newResourceId(), image = await f.image();
    const changes = [[], [image.id]].map((allowedImageIds) => f.api.saveProjectImagePolicy(f.admin, project, { expectedRevision: 0, policy: { mode: 'restricted', allowedImageIds } }));
    const outcomes = await Promise.allSettled(changes);
    const success = outcomes.filter((r) => r.status === 'fulfilled');
    expect(success).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict' } });
    expect(await f.api.getProjectImagePolicy(f.admin, project)).toEqual(success[0]!.value);
  });
});
