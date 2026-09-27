import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { releaseImageFixture } from './runtimeImageFixture';
const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof releaseImageFixture>> | undefined;
afterEach(async () => { await f?.close(); f = undefined; });
describe.skipIf(!available)('服务镜像实际发布历史', () => {
  test('只读发布自身快照，失败和下线保留，项目与版本隔离，分页不重复', async () => {
    f = await releaseImageFixture();
    const first = await f.runtime.api.publish(f.actor, f.serviceId, { branch: 'main', version: 'patch' });
    await f.runtime.api.runPipelineStep(first.id);
    const saved = (await f.uow.read.releases.getById(first.id))!;
    await f.uow.run(async (s) => s.releases.update({ ...saved, status: 'offline' }));
    const second = { ...saved, id: newResourceId() as typeof first.id, tag: 'v0.0.2', status: 'failed' as const, message: 'migration failed' };
    await f.uow.run(async (s) => s.releases.insert(second));
    const query = { projectId: f.projectId, versionIds: [f.snapshot.versionId], limit: 1 };
    expect(await f.runtime.api.imageHistory(query)).toEqual([expect.objectContaining({ id: second.id, kind: 'service', state: 'failed', name: 'v0.0.2', message: 'migration failed' })]);
    expect((await f.runtime.api.imageHistory({ ...query, before: second.id }))[0]).toMatchObject({ id: first.id, state: 'offline' });
    expect(await f.runtime.api.imageHistory({ ...query, projectId: newResourceId() })).toEqual([]);
    expect(await f.runtime.api.imageHistory({ ...query, versionIds: [newResourceId()] })).toEqual([]);
    expect(await f.runtime.api.imageHistory({ ...query, versionIds: [] })).toEqual([]);
  });
});
