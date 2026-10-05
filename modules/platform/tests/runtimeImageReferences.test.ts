import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { RuntimeImageBuildDto, RuntimeImageRevisionDto, RuntimeImageVersionDto } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { createPlatformModule, type PlatformModule } from '../wiring';
import { runtimeImageUnitOfWork } from '../../runtime-environment/adapters/persistence/unitOfWork';

const available = await testDatabaseAvailable();
let db: TestDatabase, platform: PlatformModule;
beforeAll(async () => {
  if (!available) return;
  db = await createTestDatabase();
  const settings = loadPlatformSettings({ CS_DATABASE_URL: db.url, CS_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
  platform = createPlatformModule({ db: db.db, settings, k8s: createFakeK8sClient(), logger: noopLogger, instance: 'test.image-reference' });
  await runMigrations(db.db, platform.api.migrations);
});
afterAll(async () => { await db?.drop(); });

// Seed a registered artifact, without contacting SCM or a registry. Ownership is queried through the real composition root.
async function seedReferences(ownerType = 'task') {
  const projectId = newResourceId(), imageId = newResourceId(), buildId = newResourceId(), createdBy = newResourceId();
  const version: RuntimeImageVersionDto = { id: newResourceId(), imageId, buildId, revisionId: newResourceId(), repository: 'registry.test/tools', digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/amd64', state: 'available', createdAt: new Date().toISOString(), initializerDigest: `sha256:${'b'.repeat(64)}`, toolsDigest: `sha256:${'c'.repeat(64)}` };
  const revision: RuntimeImageRevisionDto = { id: version.revisionId, imageId, revision: 1,
    source: { kind: 'existing', reference: `${version.repository}@${version.digest}`, architecture: version.architecture, usage: 'task' }, recipeDigest: version.digest,
    initializer: { steps: [], env: {}, secrets: [] }, tools: [], createdBy, createdAt: version.createdAt };
  const build: RuntimeImageBuildDto = { id: buildId, imageId, revisionId: revision.id, projectId, state: 'succeeded', stage: 'complete',
    createdBy, createdAt: version.createdAt, updatedAt: version.createdAt, deadline: version.createdAt, attempt: 1, versionId: version.id, unknown: false };
  await db.db.execute(sql`INSERT INTO runtime_environment.images (id, name, default_visible, enabled, payload) VALUES (${imageId}, 'tools', false, true, '{}'::jsonb)`);
  await db.db.execute(sql`INSERT INTO runtime_environment.revisions VALUES (${revision.id}, ${imageId}, ${revision.revision}, ${JSON.stringify(revision)}::jsonb)`);
  await db.db.execute(sql`INSERT INTO runtime_environment.builds VALUES (${buildId}, ${imageId}, ${projectId}, ${createdBy}, 'seed', 'succeeded', NULL, ${JSON.stringify(build)}::jsonb)`);
  // Catalog pins participate in the same real Registry admission as production writes.
  await runtimeImageUnitOfWork(db.db).run(({ versions }) => versions.insert(version));
  const owners = [newResourceId(), newResourceId()];
  for (const ownerId of owners) {
    const reference = { id: newResourceId(), versionId: version.id, projectId, ownerType, ownerId, state: 'confirmed', expiresAt: null, createdAt: version.createdAt };
    await db.db.execute(sql`INSERT INTO runtime_environment.references VALUES (${reference.id}, ${version.id}, ${projectId}, ${ownerType}, ${ownerId}, ${JSON.stringify(reference)}::jsonb)`);
  }
  return { version, owners, projectId };
}

describe.skipIf(!available)('运行镜像引用所有者的实际平台装配', () => {
  test('缺失业务所有者保留；晚绑定端口给出终态才回收，端口失败保持引用', async () => {
    const { version, owners, projectId } = await seedReferences();
    const images = platform.modules.runtimeEnvironment.api;
    expect(await images.reconcileReferences()).toBe(0);
    const owner = spyOn(platform.modules.businessTask.api, 'imageReferenceState').mockImplementation(async (input) => {
      expect(input).toMatchObject({ projectId, versionId: version.id, ownerType: 'task' });
      if (input.ownerId === owners[0]) return 'released';
      throw new Error('owner unavailable');
    });
    try {
      expect(await images.reconcileReferences()).toBe(1);
      expect(owner).toHaveBeenCalledTimes(2);
      const rows = await db.db.execute<{ owner_id: string }>(sql`SELECT owner_id FROM runtime_environment.references WHERE version_id = ${version.id}`);
      expect([...rows]).toEqual([{ owner_id: owners[1]! }]);
    } finally { owner.mockRestore(); }
    expect(await images.reconcileReferences()).toBe(0);
  });
  test('Agent 类别只在业务所有者 unknown 时继续查询开发所有者', async () => {
    const { version } = await seedReferences('agent');
    const business = spyOn(platform.modules.businessTask.api, 'imageReferenceState').mockResolvedValue('active');
    const development = spyOn(platform.modules.taskRuntime.api, 'imageReferenceState').mockImplementation(async (input) => input.versionId === version.id ? 'released' : 'unknown');
    try {
      expect(await platform.modules.runtimeEnvironment.api.reconcileReferences()).toBe(0);
      expect(development).not.toHaveBeenCalled();
      business.mockResolvedValue('unknown');
      expect(await platform.modules.runtimeEnvironment.api.reconcileReferences()).toBe(2);
      expect(development).toHaveBeenCalledWith(expect.objectContaining({ versionId: version.id, ownerType: 'agent' }));
    } finally { business.mockRestore(); development.mockRestore(); }
  });
});
