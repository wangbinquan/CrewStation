import { expect, test } from 'bun:test';
import { createApiClient } from '../index';

test('image uploads use multipart with an encoded project and browser-owned boundary, JSON writes stay JSON', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const api = createApiClient({ baseUrl: 'https://cs.test', headers: { 'content-type': 'application/json' }, fetch: async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ revision: 2 }); } });
  const input = { description: 'Brand', icon: 'book' as const, expectedRevision: 1 };
  await api.projects.uploadAppIcon('p/a', input, new Blob(['png'], { type: 'image/png' }));
  expect(calls[0]?.url).toBe('https://cs.test/v1/projects/p%2Fa/app-icon');
  expect(calls[0]?.init?.method).toBe('PUT'); expect(calls[0]?.init?.credentials).toBe('include');
  expect(new Headers(calls[0]?.init?.headers).has('content-type')).toBe(false);
  const body = calls[0]?.init?.body as FormData;
  expect([...body.keys()].sort()).toEqual(['file', 'presentation']);
  expect(JSON.parse(String(body.get('presentation')))).toEqual(input);
  expect(await (body.get('file') as File).text()).toBe('png');
  await api.projects.setAppPresentation('p/a', { ...input, iconSource: { kind: 'url', url: '/icon.png' } });
  expect(new Headers(calls[1]?.init?.headers).get('content-type')).toBe('application/json');
});
