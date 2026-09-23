import { expect, test } from 'bun:test';
import type { GitLabClient, GitLabProject } from '@crewstation/gitlab-client';
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
