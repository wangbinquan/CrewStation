import type { GitLabBranch, GitLabClient, GitLabProject, GitLabTag } from '@crewstation/gitlab-client';
import { GITLAB_ACCESS_LEVEL } from '@crewstation/gitlab-client';
import { isPlatformError } from '@crewstation/kernel';
import type { GitLabGateway, RemoteBranch, RemoteProject, RemoteTag } from '../../ports/gitLabGateway';

/** 会话凭据只读写仓库；开发者级别，受保护的 `v*` 标签与默认分支保护都对它生效。 */
const SESSION_TOKEN_SCOPES = ['read_repository', 'write_repository'];

const toRemoteProject = (p: GitLabProject): RemoteProject => ({ id: String(p.id), pathWithNamespace: p.pathWithNamespace, defaultBranch: p.defaultBranch ?? undefined, webUrl: p.webUrl });
const toRemoteBranch = (b: GitLabBranch): RemoteBranch => ({ name: b.name, headSha: b.commit.id, isDefault: b.default });
/** GitLab 的时间带本地时区偏移，统一成 UTC ISO 以满足 DTO 的 `z.iso.datetime()`。 */
const toRemoteTag = (t: GitLabTag): RemoteTag => ({ name: t.name, commitSha: t.commit.id, createdAt: new Date(t.commit.committedDate).toISOString(), protected: t.protected });

async function orUndefined<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    if (isPlatformError(error) && error.kind === 'not_found') return undefined;
    throw error;
  }
}

export function gitLabGatewayAdapter(client: GitLabClient): GitLabGateway {
  return {
    findProject: async (path) => {
      const project = await orUndefined(client.getProject(path));
      return project ? toRemoteProject(project) : undefined;
    },
    createProject: async ({ groupPath, slug, defaultBranch }) => {
      const group = await client.getGroup(groupPath);
      return toRemoteProject(await client.createProject({ name: slug, path: slug, namespaceId: group.id, defaultBranch, visibility: 'private', initializeWithReadme: false }));
    },
    listBranches: async (id) => (await client.listBranches(id)).map(toRemoteBranch),
    getBranch: async (id, name) => {
      const branch = await orUndefined(client.getBranch(id, name));
      return branch ? toRemoteBranch(branch) : undefined;
    },
    listTags: async (id) => (await client.listTags(id)).map(toRemoteTag),
    readFile: async (id, path, ref) => orUndefined(client.getRawFile(id, path, ref)),
    createTag: async (id, input) => toRemoteTag(await client.createTag(id, input)),
    ensureTagProtection: async (id, pattern) => {
      if ((await client.listProtectedTags(id)).some((t) => t.name === pattern)) return;
      try {
        await client.protectTag(id, { name: pattern, createAccessLevel: GITLAB_ACCESS_LEVEL.maintainer });
      } catch (error) {
        if (!(isPlatformError(error) && error.kind === 'conflict')) throw error;
      }
    },
    countCommitsBehind: async (id, { from, to }) => (await orUndefined(client.compare(id, from, to)))?.commitCount,
    createAccessToken: async (id, { name, expiresOn }) => {
      const created = await client.createProjectAccessToken(id, { name, scopes: SESSION_TOKEN_SCOPES, expiresAt: expiresOn, accessLevel: GITLAB_ACCESS_LEVEL.developer });
      return { id: String(created.id), token: created.token };
    },
    revokeAccessToken: async (id, tokenId) => { await orUndefined(client.revokeProjectAccessToken(id, Number(tokenId))); },
  };
}
