import { afterEach, describe, expect, test } from 'bun:test';
import { CreateRuntimeImageSetupSchema } from '@crewstation/contracts';
import type { RuntimeImageHistoryRead } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { builtVersion } from './versionFixture';

const available = await testDatabaseAvailable();
let f: RuntimeImageFixture | undefined;
afterEach(async () => { await f?.tdb.drop(); f = undefined; });
const setup = () => CreateRuntimeImageSetupSchema.parse({ name: 'Data tools', description: 'Python and scripts', requestKey: newResourceId(), recipe: { source: { kind: 'existing', reference: 'registry.test/tools:v1', architecture: 'linux/amd64', usage: 'task' } } });

describe.skipIf(!available)('镜像新增与历史 HTTP', () => {
  test('定义和首份配方原子保存，并发重放返回同一镜像；变更内容和撤权后重放拒绝', async () => {
    f = await runtimeImageFixture(); const input = setup(), root = `/v1/projects/${f.project}/runtime-images/setup`;
    const send = () => f!.app.request(root, { method: 'POST', headers: f!.headers(f!.admin), body: JSON.stringify(input) });
    const responses = await Promise.all([send(), send()]); expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all(responses.map((r) => r.json())); expect(first).toEqual(second);
    expect((await f.api.listImages(f.developer, f.project, { limit: 100 })).length).toBe(1);
    expect((await f.api.listRevisions(f.admin, f.project, first.image.id, { limit: 100 })).length).toBe(1);
    expect(await f.api.listBuilds(f.admin, f.project, first.image.id, { limit: 100 })).toEqual([]);
    const prepares = f.prepares(); expect(await f.api.createSetup(f.admin, f.project, input)).toEqual(first); expect(f.prepares()).toBe(prepares);
    await expect(f.api.createSetup(f.admin, f.project, { ...input, name: 'changed' })).rejects.toMatchObject({ kind: 'conflict' });
    f.admins.delete(f.admin.userId);
    expect((await send()).status).toBe(403);
  });
  test('无效来源与无权限新增不残留空定义', async () => {
    f = await runtimeImageFixture(); const input = setup();
    const response = await f.app.request(`/v1/projects/${f.project}/runtime-images/setup`, { method: 'POST', headers: f.headers(f.developer), body: JSON.stringify({ ...input, recipe: { source: { ...input.recipe.source, architecture: 'invalid' } } }) });
    expect(response.status).toBe(400);
    await expect(f.api.createSetup(f.tester, f.project, input)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(await f.api.listImages(f.developer, f.project, { limit: 100 })).toEqual([]); expect(f.prepares()).toBe(0);
  });
  test('历史按当前项目读不可变版本，严格版本归属、分页与权限；读取异常不伪装空历史', async () => {
    const reads: RuntimeImageHistoryRead[] = [];
    let failing = false;
    f = await runtimeImageFixture(undefined, undefined, undefined, undefined, { list: async (input) => {
      reads.push(input); if (failing) throw new Error('history unavailable');
      return [3, 2].map((n) => ({ id: `01a0bf5d-8f4b-7111-8111-${String(n).padStart(12, '0')}`, projectId: input.projectId!, serviceId: newResourceId(), versionId: input.versionIds[0]!, kind: 'task' as const, state: 'released', createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' }));
    } });
    const version = await builtVersion(f); await f.api.shareImage(f.admin, f.project, version.imageId, 'shared', 1);
    const root = `/v1/projects/${f.otherProject}/runtime-images/${version.imageId}/history`;
    const response = await f.app.request(`${root}?limit=1`, { headers: f.headers(f.developer) });
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = await response.json(); expect(result.items.length).toBe(1); expect(result.next).toBe(result.items[0].id);
    expect(reads[0]).toEqual({ projectId: f.otherProject, versionIds: [version.id], limit: 2 });
    const unknown = await f.app.request(`${root}?versionId=${newResourceId()}`, { headers: f.headers(f.developer) }); expect(unknown.status).toBe(404);
    const outsider = await f.app.request(root, { headers: f.headers(f.outsider) }); expect(outsider.status).toBe(403); expect(reads.length).toBe(1);
    failing = true; await expect(f.api.imageHistory(f.developer, f.project, version.imageId, { limit: 20 })).rejects.toThrow('history unavailable');
  });
});
