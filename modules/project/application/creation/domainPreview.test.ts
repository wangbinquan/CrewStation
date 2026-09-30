import { expect, test } from 'bun:test';
import type { Actor, PlatformRole, UserId } from '@crewstation/contracts';
import { projectDomainPreviewUseCase } from './domainPreview';
import { RESERVED_SLUGS } from '../../domain/project';

const userId = '01a0bf5d-8f4b-7f8b-8136-e631380738b0' as UserId;
const actor: Actor = { userId, isAdmin: false };
function preview(role: PlatformRole, domain = 'apps.example.cn') {
  return projectDomainPreviewUseCase({ users: { isAdmin: async () => role === 'admin', findByEmail: async () => undefined,
    getUser: async (id) => ({ id, name: 'Developer', email: 'dev@example.cn', platformRole: role, isAdmin: role === 'admin' }) },
    hosts: { prodHost: (s) => `${s}.${domain}`, previewHost: (s) => `preview.${s}.${domain}`, serviceHost: (s) => `${s}.services.${domain}` } });
}

test('域名预览逐项使用安装时的 HostNaming，支持两个不同安装域名', async () => {
  for (const domain of ['apps.example.cn', 'apps.other.invalid']) {
    expect(await preview('developer', domain)(actor, 'weekly-report')).toEqual({ slug: 'weekly-report', prodHost: `weekly-report.${domain}`,
      previewHost: `preview.weekly-report.${domain}`, serviceHost: `weekly-report.services.${domain}` });
  }
  expect((await preview('admin')(actor, 'weekly-report')).slug).toBe('weekly-report');
});

test('预览不接受非法或任何平台保留名；管理员声明不能覆盖当前平台角色', async () => {
  for (const slug of ['', 'BAD ID', 'ab', 'api-', ...RESERVED_SLUGS]) await expect(preview('developer')(actor, slug)).rejects.toMatchObject({ kind: 'validation', details: { field: 'slug' } });
  await expect(preview('user')({ ...actor, isAdmin: true }, 'weekly-report')).rejects.toMatchObject({ kind: 'forbidden' });
});
