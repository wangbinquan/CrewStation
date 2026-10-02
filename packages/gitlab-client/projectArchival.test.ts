import { describe, expect, test } from 'bun:test';
import { createGitLabClient } from './client';

const createdAt = '2026-09-30T16:00:35.872Z';
const original = { id: 383, pathWithNamespace: 'crewstation/example', createdAt };
const native = { id: 383, path_with_namespace: original.pathWithNamespace, created_at: createdAt, archived: false, runners_token: 'never-return-private-token' };
function fixture(reply: (method: string) => Response) {
  const calls: { path: string; method: string }[] = [];
  const client = createGitLabClient({ baseUrl: 'https://gitlab.test', token: 'glpat-native-private', fetch: (async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET';
    calls.push({ path: url.pathname, method }); return reply(method);
  }) as typeof fetch });
  return { client, calls };
}

describe('GitLab original project archival protocol', () => {
  test('reads explicit archival state, checks original identity and sends only its numeric archival request', async () => {
    const f = fixture((method) => Response.json({ ...native, archived: method === 'POST' }));
    expect(await f.client.getProjectArchivalState(383)).toEqual({ ...original, archived: false });
    const result = await f.client.archiveProject(original);
    expect(result).toEqual({ ...original, archived: true });
    expect(f.calls).toEqual([{ path: '/api/v4/projects/383', method: 'GET' }, { path: '/api/v4/projects/383', method: 'GET' }, { path: '/api/v4/projects/383/archive', method: 'POST' }]);
    expect(JSON.stringify(result)).not.toContain('never-return');
  });

  test('unknown state, replacement creation or changed path blocks before POST', async () => {
    for (const row of [{ ...native, archived: undefined }, { ...native, archived: 'false' }, { ...native, id: 384 }, { ...native, created_at: '2026-10-02T00:00:00Z' }, { ...native, path_with_namespace: 'crewstation/other' }]) {
      const f = fixture(() => Response.json(row));
      await expect(f.client.archiveProject(original)).rejects.toThrow();
      expect(f.calls).toEqual([{ path: '/api/v4/projects/383', method: 'GET' }]);
    }
  });

  test('a lost archival response is reconciled by reading the same original project without a second POST', async () => {
    let archived = false;
    const f = fixture((method) => {
      if (method === 'POST') { archived = true; throw new Error('lost response glpat-native-private'); }
      return Response.json({ ...native, archived });
    });
    await expect(f.client.archiveProject(original)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await f.client.archiveProject(original)).toEqual({ ...original, archived: true });
    expect(f.calls.map((call) => call.method)).toEqual(['GET', 'POST', 'GET']);
  });

  test('false archival ACK or replacement in the ACK never becomes successful', async () => {
    for (const response of [native, { ...native, archived: true, created_at: '2026-10-02T00:00:00Z' }, { ...native, archived: true, path_with_namespace: 'crewstation/other' }]) {
      const f = fixture((method) => Response.json(method === 'POST' ? response : native));
      await expect(f.client.archiveProject(original)).rejects.toThrow();
      expect(f.calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    }
  });

  test('invalid original identity sends no request and typed read failures remain failures', async () => {
    const f = fixture(() => Response.json(native));
    for (const identity of [{ ...original, id: 0 }, { ...original, createdAt: '' }, { ...original, pathWithNamespace: '../other' }]) {
      await expect(f.client.archiveProject(identity)).rejects.toMatchObject({ kind: 'validation' });
    }
    expect(f.calls).toHaveLength(0);
    for (const [status, kind] of [[403, 'forbidden'], [404, 'not_found'], [503, 'unavailable']] as const) {
      const failure = fixture(() => Response.json({ message: 'source glpat-native-private' }, { status }));
      await expect(failure.client.archiveProject(original)).rejects.toMatchObject({ kind });
      expect(failure.calls.map((call) => call.method)).toEqual(['GET']);
    }
  });
});
