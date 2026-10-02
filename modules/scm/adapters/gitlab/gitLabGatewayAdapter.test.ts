import { expect, test } from 'bun:test';
import type { GitLabClient, GitLabProject } from '@crewstation/gitlab-client';
import { createGitLabClient, GITLAB_ACCESS_LEVEL } from '@crewstation/gitlab-client';
import { PlatformError } from '@crewstation/kernel';
import { gitLabGatewayAdapter } from './gitLabGatewayAdapter';

const project: GitLabProject = {
  id: 42, name: 'demo', path: 'demo', pathWithNamespace: 'crewstation/demo', namespaceId: 7, defaultBranch: 'main',
  httpUrlToRepo: 'http://127.0.0.1:8929/crewstation/demo.git', sshUrlToRepo: 'ssh://git@127.0.0.1:2222/crewstation/demo.git',
  webUrl: 'http://127.0.0.1:8929/crewstation/demo', visibility: 'private', emptyRepo: false,
};

/** 只实现本用例用到的两个方法；其余方法不该被调用。 */
function stubClient(getProject: GitLabClient['getProject']): GitLabClient {
  return { getProject, getGroup: async () => ({ id: 7, name: 'crewstation', path: 'crewstation', fullPath: 'crewstation', visibility: 'private' }), createProject: async () => project } as unknown as GitLabClient;
}

test('远端项目带回 GitLab 自报的网页地址（浏览器打开用），ID 转成字符串；建仓同样带回', async () => {
  const gateway = gitLabGatewayAdapter(stubClient(async () => project));
  expect(await gateway.findProject('crewstation/demo')).toEqual({ id: '42', pathWithNamespace: 'crewstation/demo', defaultBranch: 'main', webUrl: 'http://127.0.0.1:8929/crewstation/demo' });
  expect((await gateway.createProject({ groupPath: 'crewstation', slug: 'demo', defaultBranch: 'main' })).webUrl).toBe('http://127.0.0.1:8929/crewstation/demo');
});

test('远端不存在时 findProject 返回 undefined；其他错误照样抛出', async () => {
  expect(await gitLabGatewayAdapter(stubClient(async () => { throw new PlatformError('not_found', 'GitLab 项目不存在'); })).findProject('crewstation/none')).toBeUndefined();
  await expect(gitLabGatewayAdapter(stubClient(async () => { throw new PlatformError('unavailable', 'GitLab 不可达'); })).findProject('crewstation/demo')).rejects.toMatchObject({ kind: 'unavailable' });
});

test('返回原创建时间与令牌机器人 ID，缺失字段保持未知；外部结果仍不含多余数据', async () => {
  const createdAt = '2026-09-30T16:00:35.872Z';
  const client = createGitLabClient({ baseUrl: 'https://gitlab.test', token: 'platform', fetch: (async (input) => {
    if (String(input).includes('/access_tokens')) return Response.json({ id: 7, token: 'one-time', created_at: createdAt, user_id: 99 });
    return Response.json({ id: 42, name: 'demo', path: 'demo', path_with_namespace: 'crewstation/demo', created_at: createdAt,
      namespace: { id: 7 }, default_branch: 'main', web_url: 'https://gitlab.test/crewstation/demo', visibility: 'private' });
  }) as typeof fetch });
  const gateway = gitLabGatewayAdapter(client);
  expect((await gateway.findProject('42'))?.createdAt).toBe(createdAt);
  expect(await gateway.createAccessToken('42', { name: 'proof', expiresOn: '2026-10-02' })).toEqual({ id: '7', token: 'one-time', createdAt, userId: '99' });
});

test('构建令牌只有 read_repository 与 reporter 权限，开发会话原有读写权限保留', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const client = createGitLabClient({ baseUrl: 'https://gitlab.test', token: 'platform', fetch: (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ id: 7, name: 'build', token: 'one-time', scopes: ['read_repository'], active: true, revoked: false, expires_at: '2026-09-28' });
  }) as typeof fetch });
  const gateway = gitLabGatewayAdapter(client);
  expect(await gateway.createAccessToken('42', { name: 'build', expiresOn: '2026-09-28', readOnly: true })).toEqual({ id: '7', token: 'one-time' });
  expect(bodies[0]).toMatchObject({ scopes: ['read_repository'], access_level: GITLAB_ACCESS_LEVEL.reporter });
  await gateway.createAccessToken('42', { name: 'session', expiresOn: '2026-09-28' });
  expect(bodies[1]).toMatchObject({ scopes: ['read_repository', 'write_repository'], access_level: GITLAB_ACCESS_LEVEL.developer });
});

test('源码引用与 Git tree 请求固定同一 SHA，不存在的提交返回 undefined', async () => {
  const urls: string[] = [], sha = 'c'.repeat(40);
  const client = createGitLabClient({ baseUrl: 'https://gitlab.test', token: 'platform', fetch: (async (input) => {
    const url = String(input); urls.push(url);
    if (url.includes('missing')) return Response.json({ message: '404' }, { status: 404 });
    if (url.includes('/tree')) return Response.json([{ path: 'Dockerfile', type: 'blob', mode: '100644', id: 'x', name: 'Dockerfile' }]);
    return Response.json({ id: sha, title: 'snapshot', message: '', author_name: '', author_email: '', authored_date: '', committed_date: '' });
  }) as typeof fetch });
  const gateway = gitLabGatewayAdapter(client);
  expect(await gateway.resolveCommit('42', 'main')).toBe(sha);
  expect(await gateway.listTree('42', sha)).toHaveLength(1);
  expect(urls[1]).toContain(`ref=${sha}`);
  expect(urls[1]).toContain('recursive=true');
  expect(await gateway.resolveCommit('42', 'missing')).toBeUndefined();
});
