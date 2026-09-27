import { afterEach, describe, expect, test } from 'bun:test';
import { CreateRuntimeImageRevisionSchema, type RuntimeImageSecretVersion } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { imageContentDigest } from '../domain/contentDigest';
import { runtimeImageFixture, digest } from './runtimeImageFixture';
import { passedValidation } from './versionFixture';

const available = await testDatabaseAvailable();
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

describe.skipIf(!available)('初始化凭据快照的授权与物化', () => {
  test('新准入随凭据轮换失效，已有执行按固定版本恢复，伪造快照和引用拒绝', async () => {
    const definitionId = newResourceId(), itemId = newResourceId();
    let versionNumber = 1, reads = 0;
    const stamp = (): RuntimeImageSecretVersion => ({ definitionId, itemId, environment: 'development', version: versionNumber });
    const f = await runtimeImageFixture(undefined, { versions: async () => [stamp()], values: { render: async (projectId, stamps) => {
      expect(projectId).toBe(f.project); reads++;
      return { [`development:${definitionId}`]: `secret-v${stamps[0]!.version}` };
    } } });
    cleanup.push(() => f.tdb.drop());
    const image = await f.image();
    const revision = await f.api.createRevision(f.admin, f.project, image.id, CreateRuntimeImageRevisionSchema.parse({
      source: { kind: 'existing', reference: `registry.test/project/tools@${digest}`, architecture: 'linux/amd64', usage: 'task' },
      initializer: { secrets: [{ id: 'token', environment: 'development', configDefinitionId: definitionId }] },
    }));
    const build = await f.api.startBuild(f.admin, f.project, image.id, { requestKey: 'secret-build', revisionId: revision.id });
    const version = { id: newResourceId(), projectId: f.project, imageId: image.id, revisionId: revision.id, buildId: build.id, repository: 'registry.test/project/tools', digest, architecture: 'linux/amd64' as const, state: 'available' as const, createdAt: build.createdAt, initializerDigest: imageContentDigest(revision.initializer), toolsDigest: imageContentDigest(revision.tools) };
    await f.uow.run(async (s) => { await s.versions.insert(version); await s.builds.update({ ...(await s.builds.get(build.id))!, state: 'succeeded', versionId: version.id }); });
    await passedValidation(f, version.id);
    const owner = { type: 'task' as const, id: newResourceId() }, input = { owner, selection: { runtimeImageVersionId: version.id }, target: { usage: 'task' as const } };
    const snapshot = (await f.api.reserveImage(f.developer, f.project, input))!;
    expect(snapshot.initializerSecretVersions).toEqual([stamp()]);
    versionNumber = 2;
    await expect(f.api.reserveImage(f.developer, f.project, { ...input, owner: { ...owner, id: newResourceId() } })).rejects.toMatchObject({ kind: 'precondition' });
    expect(await f.api.reserveImage(f.developer, f.project, input)).toEqual(snapshot);
    expect(await f.api.renderInitializationSecrets(f.project, owner, snapshot)).toEqual({ token: 'secret-v1' });
    await f.api.confirmReference(version.id, owner);
    expect(await f.api.renderInitializationSecrets(f.project, owner, snapshot)).toEqual({ token: 'secret-v1' });
    await expect(f.api.renderInitializationSecrets(f.otherProject, owner, snapshot)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.api.renderInitializationSecrets(f.project, { ...owner, id: newResourceId() }, snapshot)).rejects.toMatchObject({ kind: 'precondition' });
    await expect(f.api.renderInitializationSecrets(f.project, owner, { ...snapshot, initializerSecretVersions: [stamp()] })).rejects.toMatchObject({ kind: 'precondition' });
    expect(reads).toBe(2);
    await f.api.releaseReference(version.id, owner);
    await expect(f.api.renderInitializationSecrets(f.project, owner, snapshot)).rejects.toMatchObject({ kind: 'precondition' });
  });
});
