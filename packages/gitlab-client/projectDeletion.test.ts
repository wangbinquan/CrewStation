import { describe, expect, test } from 'bun:test';
import { createGitLabClient } from './client';

const token = 'glpat-deletion-protocol-secret';
const createdAt = '2026-09-30T16:00:35.872Z';
const project = { id: 383, path_with_namespace: 'crewstation/example', created_at: createdAt };
const storage = { project_id: 383, disk_path: '@hashed/48/b3/original', created_at: createdAt, repository_storage: 'default' };
const accessToken = (id: number) => ({ id, name: 'cs-session-' + id, scopes: ['read_repository'], access_level: 20, expires_at: '2026-10-01', active: false, revoked: false, created_at: createdAt, user_id: 99, token: 'must-never-return' });
function fixture(reply: (url: URL, init?: RequestInit) => Response) {
  const requests: { url: URL; method: string }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); requests.push({ url, method: init?.method ?? 'GET' }); return reply(url, init);
  }) as typeof globalThis.fetch;
  return { client: createGitLabClient({ baseUrl: 'https://gitlab.test', token, fetch }), requests };
}
const json = (value: unknown, next = '') => Response.json(value, { headers: { 'x-next-page': next } });

describe('GitLab removal source protocol', () => {
  test('created identity and explicit deletion date are retained; omitted date remains unknown', async () => {
    const { client } = fixture(() => json(project));
    expect(await client.getProjectDeletionState(383)).toEqual({ id: 383, pathWithNamespace: 'crewstation/example', createdAt });
    const scheduled = fixture(() => json({ ...project, marked_for_deletion_on: '2026-10-02', pending_delete: false, runners_token: token }));
    expect(await scheduled.client.getProjectDeletionState(383)).toEqual({ id: 383, pathWithNamespace: 'crewstation/example', createdAt, markedForDeletionOn: '2026-10-02' });
    const active = fixture(() => json({ ...project, marked_for_deletion_on: null }));
    expect((await active.client.getProjectDeletionState(383)).markedForDeletionOn).toBeNull();
  });

  test('storage accepts the installed 19.2.4 object and documented array without calculating a disk path', async () => {
    for (const body of [storage, [storage]]) {
      const { client, requests } = fixture(() => json(body));
      expect(await client.getProjectRepositoryStorage(383)).toEqual([{ projectId: 383, diskPath: storage.disk_path, createdAt, repositoryStorage: 'default' }]);
      expect(requests[0]?.url.pathname).toBe('/api/v4/projects/383/storage');
      expect(requests).toHaveLength(1);
    }
  });

  test('partial identity, wrong original ID, invalid source and impossible deletion date reject a report', async () => {
    for (const body of [{ ...project, id: 384 }, { ...project, created_at: null }, { ...project, marked_for_deletion_on: '2026-02-30' }, { ...project, marked_for_deletion_on: '9999-99-99' }]) {
      await expect(fixture(() => json(body)).client.getProjectDeletionState(383)).rejects.toMatchObject({ kind: 'unavailable' });
    }
    for (const body of [null, {}, [], [storage, { ...storage, project_id: 384 }], { ...storage, disk_path: '../../foreign' }]) {
      await expect(fixture(() => json(body)).client.getProjectRepositoryStorage(383)).rejects.toMatchObject({ kind: 'unavailable' });
    }
  });

  test('all token states are read across pages and neither raw token nor extra fields are returned', async () => {
    const { client, requests } = fixture((url) => url.searchParams.get('page') === '1' ? json(Array.from({ length: 100 }, (_, i) => accessToken(i + 1)), '2') : json([{ ...accessToken(101), active: true, revoked: true }]));
    const values = await client.listProjectAccessTokens(383);
    expect(values).toHaveLength(101);
    expect(values[100]).toMatchObject({ id: 101, active: true, revoked: true });
    expect(requests.map((r) => r.url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(requests.every((r) => !r.url.searchParams.has('state') && !r.url.searchParams.has('revoked'))).toBe(true);
    expect(JSON.stringify(values)).not.toContain('must-never-return');
    expect(JSON.stringify(values)).not.toContain('"token":');
  });

  test('second-page failure, non-array page and backwards/invalid pagination never return a partial token inventory', async () => {
    const failure = fixture((url) => url.searchParams.get('page') === '1' ? json([accessToken(1)], '2') : Response.json({ message: 'temporary ' + token }, { status: 503 }));
    await expect(failure.client.listProjectAccessTokens(383)).rejects.toMatchObject({ kind: 'unavailable' });
    for (const next of ['1', '0', '-1', '3', 'not-a-page']) {
      const malformed = fixture(() => json([accessToken(1)], next));
      await expect(malformed.client.listProjectAccessTokens(383)).rejects.toMatchObject({ kind: 'unavailable' });
      expect(malformed.requests).toHaveLength(1);
    }
    await expect(fixture(() => json({ id: 1 })).client.listProjectAccessTokens(383)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(fixture(() => json([{ ...accessToken(1), revoked: undefined }])).client.listProjectAccessTokens(383)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(fixture(() => Response.json(Array.from({ length: 100 }, (_, i) => accessToken(i + 1)))).client.listProjectAccessTokens(383)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(fixture((url) => url.searchParams.get('page') === '1' ? json([accessToken(1)], '2') : json([accessToken(1)])).client.listProjectAccessTokens(383)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('403, 404 and network failure remain typed errors for all source reads', async () => {
    for (const [status, kind] of [[403, 'forbidden'], [404, 'not_found'], [503, 'unavailable']] as const) {
      const { client } = fixture(() => Response.json({ message: 'source ' + token }, { status }));
      for (const read of [() => client.getProjectDeletionState(383), () => client.getProjectRepositoryStorage(383), () => client.listProjectAccessTokens(383)]) {
        try { await read(); throw new Error('source failure was accepted'); }
        catch (error) { expect(error).toMatchObject({ kind }); expect(JSON.stringify(error)).not.toContain(token); }
      }
    }
    const { client } = fixture(() => { throw new Error('network ' + token); });
    await expect(client.getProjectDeletionState(383)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('permanent removal requires the numeric original ID and current full path before issuing a request', async () => {
    const { client, requests } = fixture(() => new Response(null, { status: 202 }));
    for (const fullPath of [undefined, '', 'with\ncontrol']) {
      await expect(client.deleteProject(383, { permanentlyRemove: true, fullPath } as never)).rejects.toMatchObject({ kind: 'validation' });
    }
    await expect(client.deleteProject('crewstation/example', { permanentlyRemove: true, fullPath: 'crewstation/example' })).rejects.toMatchObject({ kind: 'validation' });
    expect(requests).toHaveLength(0);
    await client.deleteProject(383);
    await client.deleteProject(383, { permanentlyRemove: true, fullPath: 'crewstation/example-deletion_scheduled-383' });
    expect(requests.map((r) => r.method)).toEqual(['DELETE', 'DELETE']);
    expect(requests[0]?.url.search).toBe('');
    expect(requests[1]?.url.searchParams.get('full_path')).toBe('crewstation/example-deletion_scheduled-383');
  });
});
