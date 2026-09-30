import { describe, expect, test } from 'bun:test';
import { createApp } from '@crewstation/http';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { computeDeletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('项目构建镜像凭据的实际逐请求准入', () => {
  test('未到期旧凭据、管理员写入及跨仓mount均随项目封闭失效；其他项目和平台构建继续', async () => {
    const f = await computeDeletionFixture();
    try {
      const expiresAt = new Date(Date.now() + 600000).toISOString(), buildId = newResourceId();
      const input = { projectId: f.own.id, buildId, expiresAt, pullRepositories: ['crewstation/task-runtime'] };
      const own = await f.compute.api.issueBuildPushCredential(input), shared = await f.compute.api.issuePushCredential(f.admin);
      const kept = await f.compute.api.issueBuildPushCredential({ ...input, projectId: f.other.id, buildId: newResourceId(), pullRepositories: [`runtime/projects/${f.own.id}/${buildId}/image`, 'crewstation/task-runtime'] });
      const platform = await f.compute.api.issueBuildPushCredential({ buildId: newResourceId(), expiresAt, pullRepositories: ['crewstation/task-runtime'] });
      const app = createApp({ name: 'registry-deletion' }); for (const route of f.application().forwardAuth) app.route('/', route);
      const auth = async (token: typeof own, uri: string, method = 'PUT') => app.request('/forward-auth/registry', { headers: { authorization: `Basic ${Buffer.from(`${token.username}:${token.password}`).toString('base64')}`, 'x-forwarded-method': method, 'x-forwarded-uri': uri } });
      const target = `/v2/runtime/projects/${f.own.id}/${buildId}/image/manifests/artifact`;
      expect((await auth(own, target)).status).toBe(200);
      const started = await f.begin();
      for (const token of [own, shared]) expect((await auth(token, target)).status).toBe(403);
      expect((await auth(own, '/v2/', 'GET')).status).toBe(403);
      expect((await auth(own, '/v2/crewstation/task-runtime/manifests/dev', 'GET')).status).toBe(403);
      await expect(f.compute.api.issueBuildPushCredential(input)).rejects.toBeDefined();
      expect((await auth(kept, target, 'GET')).status).toBe(403);
      const keptPrefix = kept.pushPrefixes[0]! + 'image', ownRepo = `runtime/projects/${f.own.id}/${buildId}/image`;
      expect((await auth(kept, `/v2/${keptPrefix}/blobs/uploads/?mount=sha256:${'a'.repeat(64)}&from=${encodeURIComponent(ownRepo)}`, 'POST')).status).toBe(403);
      expect((await auth(kept, `/v2/${keptPrefix}/manifests/artifact`)).status).toBe(200);
      expect((await auth(platform, `/v2/${platform.pushPrefixes[0]}image/manifests/artifact`)).status).toBe(200);
      await f.proceed(started, 'verify');
      expect((await f.project.api.completeProjectDeletion(started.lease)).state).toBe('succeeded');
      expect((await auth(shared, target)).status).toBe(403);
      expect((await auth(own, '/v2/', 'GET')).status).toBe(403);
      expect((await auth(shared, '/v2/runtime/global-image/manifests/v1')).status).toBe(200);
      expect((await auth(shared, '/v2/runtime/projects/not-a-project/image/manifests/v1')).status).toBe(403);
    } finally { await f.database.drop(); }
  });
});
