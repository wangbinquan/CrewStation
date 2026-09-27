import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';

const available = await testDatabaseAvailable();
let f: RuntimeImageFixture;
beforeAll(async () => { if (available) f = await runtimeImageFixture(); });
afterAll(async () => { await f?.tdb.drop(); });

describe.skipIf(!available)('构建准入并发、幂等与日志授权', () => {
  test('重复请求只入一条，不同内容同 key 返回冲突；取消中仍占容量', async () => {
    const image = await f.image(), revision = await f.revision(image.id), other = await f.revision(image.id);
    const submit = (key: string, revisionId = revision.id) => f.api.startBuild(f.developer, f.project, image.id, { requestKey: key, revisionId });
    const copies = await Promise.all([submit('same'), submit('same'), submit('same')]);
    expect(new Set(copies.map((v) => v.id)).size).toBe(1);
    expect(copies[0]).not.toHaveProperty('inputDigest');
    await expect(submit('same', other.id)).rejects.toMatchObject({ kind: 'conflict' });
    await expect(submit('second')).rejects.toMatchObject({ kind: 'quota_exceeded' });
    const build = copies[0]!;
    expect(await f.api.cancelBuild(f.developer, f.project, image.id, build.id, 'stop')).toMatchObject({ state: 'cancelling' });
    await expect(submit('second')).rejects.toMatchObject({ kind: 'quota_exceeded' });
    expect(await submit('same')).toMatchObject({ id: build.id, state: 'cancelling' });
    // 模拟 worker 已确认物理回收；cancel 响应不得提前退额。
    await f.uow.run(async (s) => { const row = (await s.builds.get(build.id, true))!; await s.builds.update({ ...row, state: 'cancelled' }); });
    expect(await f.api.cancelBuild(f.developer, f.project, image.id, build.id, 'stop-again')).toMatchObject({ state: 'cancelled' });
    const races = await Promise.allSettled([submit('second'), submit('third')]);
    expect(races.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(races.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await f.uow.read.builds.activeCount(f.project)).toBe(1);
  });
  test('日志续传重新授权；到期返回 410，活动构建不提前过期', async () => {
    const image = await f.image(f.otherProject), revision = await f.revision(image.id, f.otherProject);
    const build = await f.api.startBuild(f.developer, f.otherProject, image.id, { requestKey: 'logs', revisionId: revision.id });
    for (const text of ['install python', 'install node']) await f.uow.read.logs.append(build.id, { text, stage: 'building', createdAt: build.createdAt });
    const logs = (after = 0) => f.api.buildLogs(f.developer, f.otherProject, image.id, build.id, { after, limit: 1 });
    const first = await logs();
    expect(first).toMatchObject({ expired: false, items: [{ text: 'install python' }] });
    if (first.expired) throw new Error('日志不能提前过期');
    expect(await logs(first.next)).toMatchObject({ items: [{ text: 'install node' }] });
    f.memberships.get(f.developer.userId)!.delete(f.otherProject);
    await expect(logs(first.next)).rejects.toMatchObject({ kind: 'forbidden' });
    f.memberships.get(f.developer.userId)!.add(f.otherProject);
    f.advance(61000);
    expect(await logs()).toMatchObject({ expired: false });
    await f.uow.run(async (s) => { const row = (await s.builds.get(build.id, true))!; await s.builds.update({ ...row, state: 'failed' }); });
    const response = await f.app.request(`/v1/projects/${f.otherProject}/runtime-images/${image.id}/builds/${build.id}/logs`, { headers: f.headers(f.developer) });
    expect(response.status).toBe(410);
    await expect(f.api.cancelBuild(f.developer, f.otherProject, image.id, build.id, 'late')).rejects.toMatchObject({ kind: 'conflict' });
  });
});
