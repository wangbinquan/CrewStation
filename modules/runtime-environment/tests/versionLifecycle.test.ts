import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion, passedValidation } from './versionFixture';

const available = await testDatabaseAvailable();
let f: RuntimeImageFixture;
beforeAll(async () => { if (available) f = await runtimeImageFixture(); });
afterAll(async () => { await f?.tdb.drop(); });

describe.skipIf(!available)('用途验证与持久镜像引用', () => {
  test('选择器按版本读取名称与摘要，保留项目隔离和共享边界，不返回配方', async () => {
    const version = await builtVersion(f), image = await f.api.getImage(f.developer, f.project, version.imageId);
    const get = (project: string, actor = f.developer) => f.app.request(`/v1/projects/${project}/runtime-image-versions/${version.id}`, { headers: f.headers(actor) });
    const response = await get(f.project);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const option = await response.json();
    expect(option).toMatchObject({ id: version.id, name: image.name, digest: version.digest });
    expect(option).not.toHaveProperty('source');
    expect((await get(f.otherProject)).status).toBe(404);
    expect((await get(f.project, f.outsider)).status).toBe(403);
    await f.api.shareImage(f.admin, f.project, version.imageId, 'shared', image.revision);
    expect((await get(f.otherProject)).status).toBe(200);
  });
  test('构建完成不等于可执行，精确用途验证且重复请求不改变原记录', async () => {
    const version = await builtVersion(f), owner = { type: 'task' as const, id: newResourceId() };
    const input = { selection: { runtimeImageVersionId: version.id }, target: { usage: 'task' as const }, owner };
    await expect(f.api.reserveImage(f.developer, f.project, input)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'image_usage_unvalidated' } });
    const request = { requestKey: 'validate', target: input.target };
    const [one, two] = await Promise.all([f.api.startValidation(f.developer, f.project, version.id, request), f.api.startValidation(f.developer, f.project, version.id, request)]);
    expect(one.id).toBe(two.id);
    expect(one).not.toHaveProperty('requestKey');
    await expect(f.api.startValidation(f.developer, f.project, version.id, { ...request, target: { usage: 'agent', profile: { profileId: newResourceId(), revision: 1 } } })).rejects.toMatchObject({ kind: 'conflict' });
    const passed = await passedValidation(f, version.id);
    const snapshot = await f.api.reserveImage(f.developer, f.project, input);
    expect(snapshot).toMatchObject({ validationId: passed.id, digest: version.digest, selectionSource: 'configuration' });
    expect((await f.api.versionReferences(f.developer, f.project, version.id)).items.some((ref) => ref.ownerId === owner.id && ref.state === 'reserved')).toBe(true);
    await f.api.confirmReference(version.id, owner);
    expect((await f.uow.read.references.get(version.id, owner.type, owner.id))?.expiresAt).toBeNull();
    await expect(f.api.reserveImage(f.developer, f.project, { ...input, target: { usage: 'agent', profile: { profileId: newResourceId(), revision: 1 } } })).rejects.toMatchObject({ kind: 'conflict' });
  });

  test('平台契约变更使新准入重新验证，原快照和停用前引用可恢复', async () => {
    const version = await builtVersion(f);
    await passedValidation(f, version.id);
    const input = { selection: { runtimeImageVersionId: version.id }, target: { usage: 'task' as const }, owner: { type: 'session' as const, id: newResourceId() } };
    const snapshot = await f.api.reserveImage(f.developer, f.project, input);
    f.changeContract(`sha256:${'c'.repeat(64)}`);
    expect(await f.api.reserveImage(f.developer, f.project, input)).toEqual(snapshot);
    await expect(f.api.reserveImage(f.developer, f.project, { ...input, owner: { ...input.owner, id: newResourceId() } })).rejects.toMatchObject({ kind: 'precondition' });
    await f.api.disableVersion(f.admin, f.project, version.id);
    expect(await f.api.reserveImage(f.developer, f.project, input)).toEqual(snapshot);
    // reservation 过期不能直接删除：调用方可能已提交快照但确认响应丢失。
    f.advance(3600001);
    await expect(f.api.retireVersion(f.admin, f.project, version.id)).rejects.toMatchObject({ kind: 'conflict', details: { code: 'image_in_use' } });
    await f.api.confirmReference(version.id, input.owner);
    await f.api.releaseReference(version.id, input.owner);
    expect(await f.api.retireVersion(f.admin, f.project, version.id)).toMatchObject({ version: { state: 'retired' }, physicalDeletion: 'retained' });
    await f.api.releaseReference(version.id, input.owner);
  });

  test('恢复复制原引用快照，停用后仍可恢复；跨项目与已有不同快照拒绝', async () => {
    const version = await builtVersion(f); await passedValidation(f, version.id);
    const from = { type: 'agent' as const, id: newResourceId() }, to = { ...from, id: newResourceId() }, occupied = { ...from, id: newResourceId() };
    const input = { selection: { runtimeImageVersionId: version.id }, target: { usage: 'task' as const } };
    const snapshot = await f.api.reserveImage(f.developer, f.project, { ...input, owner: from });
    await f.api.reserveImage(f.developer, f.project, { ...input, owner: occupied, requestedVersionId: version.id });
    await f.api.confirmReference(version.id, from); await f.api.disableVersion(f.admin, f.project, version.id);
    await f.api.copyReference(f.project, version.id, from, to); await f.api.copyReference(f.project, version.id, from, to);
    expect(await f.uow.read.references.get(version.id, to.type, to.id)).toMatchObject({ state: 'confirmed', expiresAt: null, snapshot });
    expect((await f.api.versionReferences(f.developer, f.project, version.id)).items.filter((ref) => ref.ownerId === to.id)).toHaveLength(1);
    await expect(f.api.copyReference(f.otherProject, version.id, from, { ...to, id: newResourceId() })).rejects.toThrow('本项目');
    await expect(f.api.copyReference(f.project, version.id, from, occupied)).rejects.toThrow('不同镜像引用');
    await f.api.releaseReference(version.id, from);
    await expect(f.api.retireVersion(f.admin, f.project, version.id)).rejects.toMatchObject({ kind: 'conflict', details: { code: 'image_in_use' } });
    await expect(f.api.copyReference(f.project, newResourceId(), from, to)).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('恢复只读验证原镜像快照，停用不漂移；跨项目、篡改和释放的引用不可恢复', async () => {
    const version = await builtVersion(f); await passedValidation(f, version.id);
    const owner = { type: 'task' as const, id: newResourceId() };
    const snapshot = (await f.api.reserveImage(f.developer, f.project, { selection: { runtimeImageVersionId: version.id }, target: { usage: 'task' }, owner }))!;
    await f.api.confirmReference(version.id, owner);
    await f.api.disableVersion(f.admin, f.project, version.id);
    const before = await f.uow.read.references.list(version.id);
    expect(await f.api.inspectReference(f.project, owner, snapshot)).toBe(true);
    expect(await f.api.inspectReference(f.otherProject, owner, snapshot)).toBe(false);
    expect(await f.api.inspectReference(f.project, { ...owner, id: newResourceId() }, snapshot)).toBe(false);
    expect(await f.api.inspectReference(f.project, owner, { ...snapshot, initializerDigest: 'd'.repeat(64) })).toBe(false);
    expect(await f.uow.read.references.list(version.id)).toEqual(before);
    await f.api.releaseReference(version.id, owner);
    expect(await f.api.inspectReference(f.project, owner, snapshot)).toBe(false);
  });

  test('停用、删除与新引用串行化；未停用不可删，普通开发者不可停用', async () => {
    const version = await builtVersion(f);
    await passedValidation(f, version.id);
    await expect(f.api.retireVersion(f.admin, f.project, version.id)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.api.disableVersion(f.developer, f.project, version.id)).rejects.toMatchObject({ kind: 'forbidden' });
    await f.api.disableVersion(f.admin, f.project, version.id);
    const results = await Promise.allSettled([
      f.api.reserveImage(f.developer, f.project, { selection: { runtimeImageVersionId: version.id }, target: { usage: 'task' }, owner: { type: 'task', id: newResourceId() } }),
      f.api.retireVersion(f.admin, f.project, version.id),
    ]);
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');
    expect((await f.api.getVersion(f.developer, f.project, version.id)).state).toBe('retired');
  });

  test('HTTP 校验版本所属镜像，跨项目验证报告隔离，后台不可绕过用途检查', async () => {
    const version = await builtVersion(f), other = await f.image();
    const root = `/v1/projects/${f.project}/runtime-images/${version.imageId}/versions/${version.id}`;
    const post = (path: string, body?: unknown) => f.app.request(path, { method: 'POST', headers: f.headers(f.developer), ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await f.app.request(`/v1/projects/${f.project}/runtime-images/${other.id}/versions/${version.id}`, { headers: f.headers(f.developer) })).status).toBe(404);
    expect((await post(`${root}/validations`, { requestKey: 'http', target: { usage: 'task' }, state: 'passed' })).status).toBe(400);
    const created = await post(`${root}/validations`, { requestKey: 'http', target: { usage: 'task' } });
    expect(created.status).toBe(202);
    const result = await created.json() as { id: string };
    expect((await f.app.request(`${root}/validations/${result.id}`, { headers: f.headers(f.developer) })).status).toBe(200);
    await f.api.shareImage(f.admin, f.project, version.imageId, 'shared', 1);
    await expect(f.api.getValidation(f.developer, f.otherProject, version.id, result.id)).rejects.toMatchObject({ kind: 'not_found' });
    expect(await f.api.listValidations(f.developer, f.otherProject, version.id)).toEqual([]);
    expect((await f.app.request(root, { method: 'DELETE', headers: f.headers(f.developer) })).status).toBe(403);
  });
});
