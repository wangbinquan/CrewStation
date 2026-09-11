import { describe, expect, test } from 'bun:test';
import type { PlatformError } from '@crewstation/kernel';
import { isPlatformError } from '@crewstation/kernel';
import { createGitLabClient } from './client';
import { extractMessage, mapGitLabError, redactSecret } from './errors';

const TOKEN = 'glpat-unit-test-secret-token';

interface Recorded { method: string; url: URL; headers: Record<string, string>; body?: unknown }

/** 假 fetch：按 `METHOD path` 查表返回响应，同时记录请求以断言头、编码与请求体。 */
function fakeFetch(routes: Record<string, (req: Recorded) => Response | Response[]>) {
  const calls: Recorded[] = [];
  const queues = new Map<string, Response[]>();
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const recorded: Recorded = { method, url, headers, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) };
    calls.push(recorded);
    const key = `${method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ message: `404 Not Found (${key})` }), { status: 404, headers: { 'content-type': 'application/json' } });
    const produced = handler(recorded);
    if (Array.isArray(produced)) {
      const queue = queues.get(key) ?? [...produced];
      queues.set(key, queue);
      return queue.shift() ?? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return produced;
  };
  return { calls, fetch: impl as unknown as typeof fetch };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const commit = { id: 'a'.repeat(40), short_id: 'aaaaaaaa', title: 't', message: 'm', author_name: 'n', author_email: 'e', authored_date: '2026-09-11T00:00:00.000Z', committed_date: '2026-09-11T00:00:00.000Z', parent_ids: [] };
const project = { id: 7, name: 'demo', path: 'demo', path_with_namespace: 'crewstation/demo', default_branch: null, http_url_to_repo: 'http://gitlab.local/crewstation/demo.git', ssh_url_to_repo: 'git@gitlab.local:crewstation/demo.git', web_url: 'http://gitlab.local/crewstation/demo', visibility: 'private', empty_repo: true, namespace: { id: 3 } };

describe('gitlab-client transport', () => {
  test('令牌只进 PRIVATE-TOKEN 头；路径引用整体 URL 编码；baseUrl 末尾斜杠被忽略', async () => {
    const { calls, fetch } = fakeFetch({ 'GET /api/v4/projects/crewstation%2Fdemo': () => json(project) });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local/', token: TOKEN, fetch });
    const result = await client.getProject('crewstation/demo');
    expect(result).toMatchObject({ id: 7, pathWithNamespace: 'crewstation/demo', defaultBranch: null, emptyRepo: true, namespaceId: 3 });
    expect(calls[0]?.headers['PRIVATE-TOKEN']).toBe(TOKEN);
    expect(calls[0]?.url.toString()).toBe('http://gitlab.local/api/v4/projects/crewstation%2Fdemo');
    expect(calls[0]?.url.toString()).not.toContain(TOKEN);
  });

  test('按 x-next-page 翻页取完全部分支', async () => {
    const page = (names: string[], next: string) => json(names.map((name) => ({ name, commit, default: name === 'main', protected: false, merged: false })), 200, { 'x-next-page': next });
    const { calls, fetch } = fakeFetch({ 'GET /api/v4/projects/7/repository/branches': () => [page(['main', 'a'], '2'), page(['b'], '')] });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
    const branches = await client.listBranches(7);
    expect(branches.map((b) => b.name)).toEqual(['main', 'a', 'b']);
    expect(branches[0]?.default).toBe(true);
    expect(calls.map((c) => c.url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(calls[0]?.url.searchParams.get('per_page')).toBe('100');
  });

  test('createProject 请求体字段映射；默认不生成 README', async () => {
    const { calls, fetch } = fakeFetch({ 'POST /api/v4/projects': () => json({ ...project, default_branch: 'main' }, 201) });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
    await client.createProject({ name: 'demo', path: 'demo', namespaceId: 3, defaultBranch: 'main', visibility: 'private' });
    expect(calls[0]?.body).toEqual({ name: 'demo', path: 'demo', namespace_id: 3, default_branch: 'main', visibility: 'private', initialize_with_readme: false });
    expect(calls[0]?.headers['content-type']).toBe('application/json');
  });

  test('deleteProject 默认无参数；永久删除带 permanently_remove 与 full_path', async () => {
    const { calls, fetch } = fakeFetch({ 'DELETE /api/v4/projects/7': () => json({ message: '202 Accepted' }, 202) });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
    await client.deleteProject(7);
    expect(calls[0]?.url.search).toBe('');
    await client.deleteProject(7, { permanentlyRemove: true, fullPath: 'g/p-deletion_scheduled-7' });
    expect(calls[1]?.url.searchParams.get('permanently_remove')).toBe('true');
    expect(calls[1]?.url.searchParams.get('full_path')).toBe('g/p-deletion_scheduled-7');
  });

  test('compare 返回落后提交数；createTag 与 protectTag 的请求体', async () => {
    const { calls, fetch } = fakeFetch({
      'GET /api/v4/projects/7/repository/compare': () => json({ commits: [commit, commit], compare_same_ref: false, compare_timeout: false }),
      'POST /api/v4/projects/7/repository/tags': () => json({ name: 'v1.0.0', message: 'r', target: commit.id, commit, protected: true }, 201),
      'POST /api/v4/projects/7/protected_tags': () => json({ name: 'v*', create_access_levels: [{ access_level: 40, access_level_description: 'Maintainers' }] }, 201),
    });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
    expect((await client.compare(7, 'feature', 'main')).commitCount).toBe(2);
    expect(calls[0]?.url.searchParams.get('from')).toBe('feature');
    expect(calls[0]?.url.searchParams.get('to')).toBe('main');
    const tag = await client.createTag(7, { name: 'v1.0.0', ref: commit.id, message: 'r' });
    expect(tag).toMatchObject({ name: 'v1.0.0', protected: true, commit: { id: commit.id } });
    expect(calls[1]?.body).toEqual({ tag_name: 'v1.0.0', ref: commit.id, message: 'r' });
    const protectedTag = await client.protectTag(7, { name: 'v*', createAccessLevel: 40 });
    expect(protectedTag.createAccessLevels[0]?.accessLevel).toBe(40);
    expect(calls[2]?.body).toEqual({ name: 'v*', create_access_level: 40 });
  });

  test('项目访问令牌：到期日取 UTC 日期，明文只在创建响应里返回；撤销走 DELETE', async () => {
    const raw = { id: 12, name: 'cs-session-x', scopes: ['read_repository', 'write_repository'], access_level: 30, expires_at: '2026-09-12', active: true, revoked: false, created_at: '2026-09-11T00:00:00Z', user_id: 99, token: 'glpat-created-once' };
    const { calls, fetch } = fakeFetch({
      'POST /api/v4/projects/7/access_tokens': () => json(raw, 201),
      'DELETE /api/v4/projects/7/access_tokens/12': () => new Response(null, { status: 204 }),
    });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
    const created = await client.createProjectAccessToken(7, { name: 'cs-session-x', scopes: ['read_repository', 'write_repository'], expiresAt: new Date('2026-09-12T23:30:00Z'), accessLevel: 30 });
    expect(created.token).toBe('glpat-created-once');
    expect(calls[0]?.body).toEqual({ name: 'cs-session-x', scopes: ['read_repository', 'write_repository'], expires_at: '2026-09-12', access_level: 30 });
    await client.revokeProjectAccessToken(7, 12);
    expect(calls[1]?.method).toBe('DELETE');
  });

  test('addWebhook 把事件列表展开成 *_events 标记，令牌进请求体', async () => {
    const { calls, fetch } = fakeFetch({
      'POST /api/v4/projects/7/hooks': () => json({ id: 1, project_id: 7, url: 'https://cs/hook', push_events: true, tag_push_events: true, issues_events: false, enable_ssl_verification: true, created_at: '2026-09-11T00:00:00Z' }, 201),
    });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
    const hook = await client.addWebhook(7, { url: 'https://cs/hook', token: 'hook-secret', events: ['push', 'tag_push'] });
    expect(hook.events).toEqual(['push', 'tag_push']);
    expect(calls[0]?.body).toMatchObject({ url: 'https://cs/hook', token: 'hook-secret', push_events: true, tag_push_events: true, issues_events: false, merge_requests_events: false });
  });

  test('getRepositoryTree 透传 path／ref／recursive', async () => {
    const { calls, fetch } = fakeFetch({ 'GET /api/v4/projects/7/repository/tree': () => json([{ id: 'x', name: 'README.md', type: 'blob', path: 'README.md', mode: '100644' }]) });
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
    const entries = await client.getRepositoryTree(7, 'src', { ref: 'main', recursive: true });
    expect(entries[0]?.type).toBe('blob');
    expect(calls[0]?.url.searchParams.get('path')).toBe('src');
    expect(calls[0]?.url.searchParams.get('ref')).toBe('main');
    expect(calls[0]?.url.searchParams.get('recursive')).toBe('true');
  });
});

describe('gitlab-client error mapping', () => {
  const clientWith = (status: number, body: unknown) => {
    const { fetch } = fakeFetch({ 'GET /api/v4/projects/7': () => json(body, status) });
    return createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch });
  };
  const kindOf = async (status: number, body: unknown): Promise<string> => {
    try {
      await clientWith(status, body).getProject(7);
      return 'no-error';
    } catch (error) {
      return isPlatformError(error) ? error.kind : 'not-platform-error';
    }
  };

  test('404→not_found；409 与“已存在”类 400→conflict；401／403→forbidden；其他 400→validation；5xx→unavailable', async () => {
    expect(await kindOf(404, { message: '404 Project Not Found' })).toBe('not_found');
    expect(await kindOf(409, { message: 'Conflict' })).toBe('conflict');
    expect(await kindOf(400, { message: { path: ['has already been taken'] } })).toBe('conflict');
    expect(await kindOf(400, { message: 'Tag v1.0.0 already exists' })).toBe('conflict');
    expect(await kindOf(401, { message: '401 Unauthorized' })).toBe('forbidden');
    expect(await kindOf(403, { message: '403 Forbidden' })).toBe('forbidden');
    expect(await kindOf(400, { message: { name: ['is too long'] } })).toBe('validation');
    expect(await kindOf(500, 'boom')).toBe('unavailable');
    expect(await kindOf(429, { message: 'Retry later' })).toBe('unavailable');
  });

  test('fetch 抛错→unavailable，且消息不含令牌', async () => {
    const failing = (async () => { throw new Error(`connect ECONNREFUSED ${TOKEN}`); }) as unknown as typeof fetch;
    const client = createGitLabClient({ baseUrl: 'http://gitlab.local', token: TOKEN, fetch: failing });
    try {
      await client.getProject(7);
      throw new Error('should fail');
    } catch (error) {
      expect(isPlatformError(error) && error.kind).toBe('unavailable');
      expect((error as Error).message).not.toContain(TOKEN);
      expect((error as Error).message).toContain('***');
    }
  });

  test('错误消息与 details 都不包含令牌，GitLab 提示被保留', async () => {
    try {
      await clientWith(403, { message: `insufficient scope for token ${TOKEN}` }).getProject(7);
      throw new Error('should fail');
    } catch (error) {
      expect(isPlatformError(error)).toBe(true);
      const platformError = error as PlatformError;
      expect(platformError.message).toContain('insufficient scope');
      expect(platformError.message).not.toContain(TOKEN);
      expect(JSON.stringify(platformError.details)).not.toContain(TOKEN);
      expect(platformError.details).toMatchObject({ status: 403, method: 'GET', path: '/projects/7' });
    }
  });

  test('extractMessage 压平三种错误体；redactSecret 处理空令牌', () => {
    expect(extractMessage(JSON.stringify({ message: 'plain' }))).toBe('plain');
    expect(extractMessage(JSON.stringify({ message: { path: ['has already been taken'], name: ['x'] } }))).toBe('path has already been taken; name x');
    expect(extractMessage(JSON.stringify({ error: 'invalid_token' }))).toBe('invalid_token');
    expect(extractMessage('<html>oops</html>')).toBe('<html>oops</html>');
    expect(redactSecret('a secret b', 'secret')).toBe('a *** b');
    expect(redactSecret('unchanged', '')).toBe('unchanged');
    expect(mapGitLabError(422, JSON.stringify({ message: { tag_name: ['has already been taken'] } }), { method: 'POST', path: '/x' }).kind).toBe('conflict');
  });
});
