import { afterAll, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { httpRuntimeImageRegistry } from '../adapters/registry/runtimeImageRegistry';
import { liveRegistryFixture } from './liveRegistryFixture';

const url = process.env.CS_RUNTIME_IMAGE_REGISTRY_URL;
if (!url) console.warn('[runtime-images] real registry acceptance skipped: CS_RUNTIME_IMAGE_REGISTRY_URL is unset');
const available = url ? await testDatabaseAvailable() : false;
let f: Awaited<ReturnType<typeof liveRegistryFixture>> | undefined;
afterAll(async () => { await f?.tdb.drop(); });

describe.skipIf(!available)('真实仓库已有镜像登记与引用生命周期', () => {
  test('读取真实响应字节固定摘要，不建 builder；引用阻断退休，退休不删除仓库产物', async () => {
    const reference = process.env.CS_RUNTIME_IMAGE_REGISTRY_REFERENCE;
    if (!reference) throw new Error('CS_RUNTIME_IMAGE_REGISTRY_REFERENCE is required for real registry acceptance');
    f = await liveRegistryFixture(url!, reference, process.env.CS_RUNTIME_IMAGE_REGISTRY_ARCH ?? 'linux/arm64');
    const image = await f.api.createImage(f.admin, f.project, { name: 'live-registry-proof', description: '' });
    const revision = await f.api.createRevision(f.admin, f.project, image.id, f.source);
    expect(revision.source.kind).toBe('existing');
    if (revision.source.kind !== 'existing') throw new Error('Expected existing image source');
    expect(revision.source.reference).toMatch(/@sha256:[0-9a-f]{64}$/);
    const build = await f.api.startBuild(f.admin, f.project, image.id, { revisionId: revision.id, requestKey: newResourceId() });
    await f.api.runBuild(build.id);
    expect(await f.api.getBuild(f.admin, f.project, image.id, build.id)).toMatchObject({ state: 'succeeded', unknown: false });
    const version = (await f.api.listVersions(f.admin, f.project, image.id, { limit: 10 }))[0]!;
    expect(`${version.repository}@${version.digest}`).toBe(revision.source.reference);
    const target = { usage: 'service' as const, command: ['sh', '-c', 'echo contract-only'], port: 8080, healthPath: '/' };
    const validation = await f.api.startValidation(f.admin, f.project, version.id, { requestKey: newResourceId(), target });
    await f.api.runValidation(validation.id);
    const validated = await f.api.getValidation(f.admin, f.project, version.id, validation.id);
    expect(validated).toMatchObject({ state: 'passed', verification: 'service-contract' });
    expect(validated.observedImageId).toBeUndefined();
    const owner = { type: 'release' as const, id: newResourceId() };
    const snapshot = await f.api.reserveImage(f.admin, f.project, { selection: { runtimeImageVersionId: version.id }, target, owner });
    expect(snapshot?.image).toBe(revision.source.reference);
    await f.api.confirmReference(version.id, owner); await f.api.disableVersion(f.admin, f.project, version.id);
    await expect(f.api.retireVersion(f.admin, f.project, version.id)).rejects.toMatchObject({ kind: 'conflict' });
    await f.api.releaseReference(version.id, owner);
    expect(await f.api.retireVersion(f.admin, f.project, version.id)).toMatchObject({ version: { state: 'retired' }, physicalDeletion: 'pending-maintenance' });
    const registry = httpRuntimeImageRegistry(f.layout);
    expect(await registry.inspect(revision.source.reference, version.architecture, { exact: [f.repository] })).toMatchObject({ digest: version.digest });
    await expect(registry.inspect(revision.source.reference, version.architecture === 'linux/arm64' ? 'linux/amd64' : 'linux/arm64', { exact: [f.repository] })).rejects.toMatchObject({ kind: 'validation' });
    await expect(registry.inspect(revision.source.reference, version.architecture, { prefixes: ['foreign'] })).rejects.toMatchObject({ kind: 'validation' });
    expect(f.sideEffects()).toBe(0);
    console.info(JSON.stringify({ reference, registered: revision.source.reference, architecture: version.architecture, verification: validated.verification, physicalDeletion: 'pending-maintenance', sideEffects: f.sideEffects() }));
  }, 60000);
});
