import { describe, expect, test } from 'bun:test';
import { liveRegistryMountFixture, uploadBlob } from './liveRegistryMountFixture';

const origin = process.env.CS_REGISTRY_MOUNT_ACCEPTANCE_URL;
if (!origin) console.warn('[registry] live mount acceptance skipped: CS_REGISTRY_MOUNT_ACCEPTANCE_URL is unset (requires a disposable registry)');

describe.skipIf(!origin)('真实 registry 跨仓库 blob 挂载的构建凭据隔离', () => {
  test('允许读取底座后挂载，未知来源拒绝且不转发；普通上传和过期裁定保持', async () => {
    const f = await liveRegistryMountFixture(origin!);
    try {
      const base = await uploadBlob(f.endpoint, f.base, 'public-base-fixture');
      const foreign = await uploadBlob(f.endpoint, f.foreign, 'private-project-fixture');
      const mount = (digest: string, from?: string) => `/v2/${f.target}/blobs/uploads/?mount=${digest}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
      const allowed = await f.request(mount(base, f.base));
      expect(allowed.status).toBe(201);
      expect(await (await f.request(`/v2/${f.target}/blobs/${base}`, 'GET')).text()).toBe('public-base-fixture');
      const before = f.forwarded();
      for (const path of [mount(foreign, f.foreign), mount(foreign), `${mount(foreign, f.base)}&from=${encodeURIComponent(f.foreign)}`]) {
        expect((await f.request(path)).status).toBe(403);
      }
      expect(f.forwarded()).toBe(before);
      expect((await f.request(`/v2/${f.target}/blobs/${foreign}`, 'GET')).status).toBe(404);
      // Control request confirms the registry would perform this mount if the gateway did not check the source.
      expect((await fetch(new URL(mount(foreign, f.foreign), f.endpoint), { method: 'POST' })).status).toBe(201);
      expect((await f.request(`/v2/${f.target}/blobs/uploads/`)).status).toBe(202);
      f.expire();
      const expired = await f.request('/v2/', 'GET');
      expect(expired.status).toBe(401); expect(expired.headers.get('www-authenticate')).toContain('Basic');
    } finally { await f.close(); }
  }, 30000);
});
