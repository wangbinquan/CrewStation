import type { GitLabBranch, GitLabClient, GitLabProject, GitLabTag } from '@crewstation/gitlab-client';
import { GITLAB_ACCESS_LEVEL } from '@crewstation/gitlab-client';
import { conflict, isPlatformError } from '@crewstation/kernel';
import type { GitLabGateway, RemoteBranch, RemoteProject, RemoteRepositoryRemoval, RemoteTag } from '../../ports/gitLabGateway';

/** 会话凭据只读写仓库；开发者级别，受保护的 `v*` 标签与默认分支保护都对它生效。 */
const SESSION_TOKEN_SCOPES = ['read_repository', 'write_repository'];

const toRemoteProject = (p: GitLabProject): RemoteProject => ({ id: String(p.id), ...(p.createdAt ? { createdAt: p.createdAt } : {}), pathWithNamespace: p.pathWithNamespace, defaultBranch: p.defaultBranch ?? undefined, webUrl: p.webUrl });
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

function removalGateway(client: GitLabClient): RemoteRepositoryRemoval {
  return {
    read: async (id) => { const row = await client.getProjectDeletionState(id); return { ...row, id: String(row.id) }; },
    storage: async (id) => (await client.getProjectRepositoryStorage(id)).map((row) => ({ ...row, projectId: String(row.projectId) })),
    credentials: async (id) => (await client.listProjectAccessTokens(id)).map((row) => ({ id: String(row.id), name: row.name, active: row.active, revoked: row.revoked, createdAt: row.createdAt })),
    archive: async (identity) => {
      const current = await client.getProjectArchivalState(identity.id);
      if (String(current.id) !== identity.id || current.createdAt !== identity.createdAt || current.pathWithNamespace !== identity.pathWithNamespace) throw conflict('GitLab 原仓库身份或路径变化；禁止归档替换实例');
      const result = await client.archiveProject(current); return { ...result, id: String(result.id) };
    },
    request: async (identity, permanentlyRemove) => {
      const current = await client.getProjectDeletionState(identity.id);
      if (String(current.id) !== identity.id || current.pathWithNamespace !== identity.pathWithNamespace || current.createdAt !== identity.createdAt) throw conflict('GitLab 原仓库身份或路径变化；禁止删除替换实例');
      await client.deleteProject(current.id, permanentlyRemove ? { permanentlyRemove: true, fullPath: current.pathWithNamespace } : {});
    },
  };
}

export function gitLabGatewayAdapter(client: GitLabClient): GitLabGateway {
  return {
    removal: removalGateway(client),
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
    resolveCommit: async (id, ref) => (await orUndefined(client.getCommit(id, ref)))?.id,
    listTree: (id, ref) => client.getRepositoryTree(id, '', { ref, recursive: true }),
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
    createAccessToken: async (id, { name, expiresOn, readOnly }) => {
      const created = await client.createProjectAccessToken(id, { name, scopes: readOnly ? ['read_repository'] : SESSION_TOKEN_SCOPES, expiresAt: expiresOn, accessLevel: readOnly ? GITLAB_ACCESS_LEVEL.reporter : GITLAB_ACCESS_LEVEL.developer });
      return { id: String(created.id), token: created.token, ...(typeof created.createdAt === 'string' ? { createdAt: created.createdAt } : {}), ...(Number.isSafeInteger(created.userId) && created.userId > 0 ? { userId: String(created.userId) } : {}) };
    },
    revokeAccessToken: async (id, tokenId) => { await orUndefined(client.revokeProjectAccessToken(id, Number(tokenId))); },
  };
}
