import { expect, test } from 'bun:test';
import { createApiClient } from '../index';

test('创建域名预览只读，标识作为单一查询值编码，不拼接成路径或额外参数', async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const client = createApiClient({ baseUrl: 'https://console.example.cn', fetch: async (raw, init) => {
    calls.push({ url: new URL(String(raw)), init });
    return Response.json({ slug: 'weekly-report', prodHost: 'weekly-report.apps.cn', previewHost: 'preview.weekly-report.apps.cn', serviceHost: 'weekly-report.svc.cn' });
  } });
  expect((await client.catalog.projectDomainPreview('weekly-report')).prodHost).toBe('weekly-report.apps.cn');
  await client.catalog.projectDomainPreview('bad&id=another');
  expect(calls.map(({ url }) => url.pathname)).toEqual(['/v1/catalog/project-domain-preview', '/v1/catalog/project-domain-preview']);
  expect(calls.map(({ init }) => init?.method)).toEqual(['GET', 'GET']);
  expect(calls.every(({ init }) => init?.body === undefined)).toBe(true);
  expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({ slug: 'bad&id=another' });
});
