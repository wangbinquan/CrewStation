import { describe, expect, test } from 'bun:test';
import { createGitLabClient } from '@crewstation/gitlab-client';
import { gitLabGatewayAdapter } from './gitLabGatewayAdapter';

const createdAt = '2026-09-30T16:00:35.872Z';
const original = { id: '383', pathWithNamespace: 'crewstation/example', createdAt };
function fixture() {
  let project = { id: 383, path_with_namespace: original.pathWithNamespace, created_at: createdAt }, status = 200;
  const requests: { path: string; method: string; search: URLSearchParams }[] = [];
  const client = createGitLabClient({ baseUrl: 'http://gitlab.test', token: 'glpat-owned-private', fetch: (async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET'; requests.push({ path: url.pathname, method, search: url.searchParams });
    if (status !== 200) return Response.json({ message: 'source unavailable' }, { status });
    if (method === 'DELETE') return new Response(null, { status: 202 });
    if (url.pathname.endsWith('/storage')) return Response.json({ project_id: 383, disk_path: '@hashed/48/b3/original', created_at: createdAt, repository_storage: 'default' });
    if (url.pathname.endsWith('/access_tokens')) return Response.json([{ id: 513, name: 'cs-build-original', scopes: ['read_repository'], access_level: 20, active: false, revoked: false, created_at: createdAt, expires_at: '2026-10-01', user_id: 9, token: 'never-return' }]);
    return Response.json(project);
  }) as typeof fetch });
  return { gateway: gitLabGatewayAdapter(client).removal!, requests, replace: (next: Partial<typeof project>) => { project = { ...project, ...next }; }, fail: (code: number) => { status = code; } };
}

describe('SCM original repository removal adapter', () => {
  test('read identities, installed storage path and expired token IDs without plaintext or invented deletion state', async () => {
    const { gateway, requests } = fixture();
    expect(await gateway.read('383')).toEqual(original);
    expect(await gateway.storage('383')).toEqual([{ projectId: '383', diskPath: '@hashed/48/b3/original', createdAt, repositoryStorage: 'default' }]);
    expect(await gateway.credentials('383')).toEqual([{ id: '513', name: 'cs-build-original', active: false, revoked: false, createdAt }]);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  test('schedule and permanent requests verify the original creation identity and current path immediately before DELETE', async () => {
    const f = fixture(); await f.gateway.request(original, false);
    const scheduledPath = original.pathWithNamespace + '-deletion_scheduled-383';
    f.replace({ path_with_namespace: scheduledPath });
    await f.gateway.request({ ...original, pathWithNamespace: scheduledPath }, true);
    expect(f.requests.map((r) => r.method)).toEqual(['GET', 'DELETE', 'GET', 'DELETE']);
    expect(f.requests[1]?.search.toString()).toBe('');
    expect(f.requests[3]?.search.get('permanently_remove')).toBe('true');
    expect(f.requests[3]?.search.get('full_path')).toBe(scheduledPath);
  });

  test('changed ID, creation identity or path rejects without sending any DELETE', async () => {
    for (const replacement of [{ id: 384 }, { created_at: '2026-10-02T00:00:00Z' }, { path_with_namespace: 'crewstation/other' }]) {
      const f = fixture(); f.replace(replacement);
      await expect(f.gateway.request(original, true)).rejects.toThrow();
      expect(f.requests.map((r) => r.method)).toEqual(['GET']);
    }
  });

  test('API absence, forbidden and unavailable remain errors instead of a completed physical proof', async () => {
    for (const [status, kind] of [[404, 'not_found'], [403, 'forbidden'], [503, 'unavailable']] as const) {
      const f = fixture(); f.fail(status);
      await expect(f.gateway.read('383')).rejects.toMatchObject({ kind });
      await expect(f.gateway.storage('383')).rejects.toMatchObject({ kind });
      await expect(f.gateway.credentials('383')).rejects.toMatchObject({ kind });
      await expect(f.gateway.request(original, true)).rejects.toMatchObject({ kind });
      expect(f.requests.every((r) => r.method === 'GET')).toBe(true);
    }
  });
});
