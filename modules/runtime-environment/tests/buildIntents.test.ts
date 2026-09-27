import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { databaseBuildIntents } from '../adapters/persistence/buildIntents';
import { runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { k8sBuildFixture } from './k8sBuildFixture';

const available = await testDatabaseAvailable(), fixtures: RuntimeImageFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.tdb.drop(); });
describe.skipIf(!available)('持久构建意图的 epoch 与取消隔离', () => {
  test('取消后旧控制器不能声明、释放或登记凭据；当前控制器只能发出释放意图', async () => {
    const f = await runtimeImageFixture(); fixtures.push(f);
    const image = await f.image(), revision = await f.revision(image.id);
    const created = await f.api.startBuild(f.admin, f.project, image.id, { requestKey: 'one', revisionId: revision.id });
    const old = { ...(await f.uow.read.builds.get(created.id))!, epoch: 1, leaseOwner: 'worker', leaseUntil: '2026-09-27T00:01:00Z' };
    await f.uow.run(async (s) => s.builds.update(old));
    const plan = { ...k8sBuildFixture().plan, buildId: old.id, projectId: old.projectId, resourceId: old.resourceId! };
    let declared = 0, released = 0;
    const record = { id: old.resourceId!, desired: 'present' as const, phase: 'pending', spec: { children: [] }, children: [], conditions: [] };
    const intents = databaseBuildIntents(f.tdb.db, { get: async () => record, within: () => ({ declare: async () => { declared++; return record; }, requestRelease: async () => { released++; return record; } }) }, { now: () => new Date('2026-09-27T00:00:00Z') });
    expect(await intents.declare(old, plan)).toBe(true);
    expect(await intents.declare(old, plan)).toBe(true); expect(declared).toBe(1);
    expect(await intents.addCredential(old.id, 1, 'git-id')).toBe(true);
    await f.api.cancelBuild(f.admin, f.project, image.id, old.id, 'cancel');
    expect(await intents.declare(old, plan)).toBe(false); expect(await intents.stop(old)).toBe(false);
    expect(await intents.addCredential(old.id, 1, 'late-id')).toBe(false);
    const next = { ...(await intents.get(old.id))!, epoch: 3, leaseOwner: 'next', leaseUntil: '2026-09-27T00:01:00Z' };
    await f.uow.run(async (s) => s.builds.update(next));
    expect(await intents.declare(next, plan)).toBe(false); expect(await intents.stop(next)).toBe(true);
    expect(declared).toBe(1); expect(released).toBe(1);
    expect((await intents.get(old.id))!.gitCredentialIds).toEqual(['git-id']);
  });
});
