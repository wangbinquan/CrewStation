import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { newResourceId } from '@crewstation/kernel';
import { runtimeEnvironmentMigrations } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('平台镜像目录升级', () => {
  test('旧私有和共享镜像保留授权、Secret 业务与构建现场，版本身份和执行引用不变；可幂等重启', async () => {
    const previous = { ...runtimeEnvironmentMigrations, files: runtimeEnvironmentMigrations.files.filter((file) => file.name < '0005') };
    const tdb = await createTestDatabase([previous]);
    try {
      const project = newResourceId(), image = newResourceId(), shared = newResourceId(), revision = newResourceId(), build = newResourceId(), version = newResourceId(), actor = newResourceId();
      const digest = `sha256:${'a'.repeat(64)}`, snapshot = { versionId: version, image: `registry/tools@${digest}`, initializerSecretVersions: [{ name: 'TOKEN', version: 'fixed' }] };
      const recipe = { id: revision, imageId: image, recipeDigest: digest, initializer: { steps: [], secrets: [{ name: 'TOKEN', ref: 'token' }] } };
      const buildPayload = { id: build, imageId: image, revisionId: revision, projectId: project, state: 'building', resourcePlan: { namespace: 'old-namespace', projectId: project }, gitCredentialIds: ['retained-ticket'] };
      await tdb.db.execute(sql`INSERT INTO runtime_environment.images VALUES (${image}, ${project}, 'private', 'project', true, ${JSON.stringify({ id: image, projectId: project, scope: 'project' })}::jsonb), (${shared}, ${project}, 'shared', 'shared', true, ${JSON.stringify({ id: shared, projectId: project, scope: 'shared' })}::jsonb)`);
      await tdb.db.execute(sql`INSERT INTO runtime_environment.revisions VALUES (${revision}, ${image}, 1, ${JSON.stringify(recipe)}::jsonb)`);
      await tdb.db.execute(sql`INSERT INTO runtime_environment.builds (id, image_id, project_id, actor_id, request_key, state, payload) VALUES (${build}, ${image}, ${project}, ${actor}, 'accepted', 'building', ${JSON.stringify(buildPayload)}::jsonb)`);
      await tdb.db.execute(sql`INSERT INTO runtime_environment.versions VALUES (${version}, ${image}, ${project}, ${build}, 'registry/tools', ${digest}, 'available', ${JSON.stringify({ id: version, imageId: image, revisionId: revision, buildId: build, projectId: project, digest })}::jsonb)`);
      await tdb.db.execute(sql`INSERT INTO runtime_environment.references VALUES (${newResourceId()}, ${version}, ${project}, 'task', 'old-task', ${JSON.stringify(snapshot)}::jsonb)`);
      await tdb.db.execute(sql`INSERT INTO runtime_environment.creation_requests VALUES (${project}, ${actor}, 'setup', 'old-fingerprint', ${image}, ${revision})`);
      const upgraded = await runMigrations(tdb.db, [runtimeEnvironmentMigrations]);
      expect(upgraded).toEqual(runtimeEnvironmentMigrations.files.filter((file) => file.name >= '0005').map((file) => `runtime-environment/${file.name}`));
      expect(upgraded[0]).toBe('runtime-environment/0005_platform_catalog.sql');
      expect([...(await tdb.db.execute(sql`SELECT id, default_visible, payload FROM runtime_environment.images ORDER BY name`))]).toEqual([
        { id: image, default_visible: false, payload: { id: image, defaultVisible: false } }, { id: shared, default_visible: true, payload: { id: shared, defaultVisible: true } },
      ]);
      expect([...(await tdb.db.execute(sql`SELECT project_id FROM runtime_environment.image_project_grants`))]).toEqual([{ project_id: project }, { project_id: project }]);
      expect([...(await tdb.db.execute(sql`SELECT payload FROM runtime_environment.revisions`))]).toEqual([{ payload: { ...recipe, sourceProjectId: project, initializerProjectId: project } }]);
      expect([...(await tdb.db.execute(sql`SELECT project_id, payload FROM runtime_environment.builds`))]).toEqual([{ project_id: project, payload: { ...buildPayload, sourceProjectId: project } }]);
      expect([...(await tdb.db.execute(sql`SELECT payload FROM runtime_environment.versions`))]).toEqual([{ payload: { id: version, imageId: image, revisionId: revision, buildId: build, digest } }]);
      expect([...(await tdb.db.execute(sql`SELECT payload FROM runtime_environment.references`))]).toEqual([{ payload: snapshot }]);
      expect([...(await tdb.db.execute(sql`SELECT request_scope, fingerprint FROM runtime_environment.creation_requests`))]).toEqual([{ request_scope: project, fingerprint: 'old-fingerprint' }]);
      expect(await runMigrations(tdb.db, [runtimeEnvironmentMigrations])).toEqual([]);
    } finally { await tdb.drop(); }
  });
});
