import { GitLabNativeInventorySchema } from '@crewstation/gitlab-client';
import type { createGitLabNativeClient, GitLabAccessToken, GitLabClient, GitLabNativeInventory, GitLabNativeRequest } from '@crewstation/gitlab-client';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ScmCurrentNativeRepository, ScmCurrentNativeToken, ScmCurrentRepositoryOriginsSource } from '../../ports/currentRepositoryOrigins';

type Native = ReturnType<typeof createGitLabNativeClient>;
type Rest = Pick<GitLabClient, 'getProjectDeletionState' | 'listProjectAccessTokens'>;
const time = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) throw precondition('GitLab 当前原生出生身份缺失');
  return new Date(value).toISOString();
};
const sorted = <T>(values: readonly T[]) => [...values].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));
const token = (row: GitLabAccessToken): ScmCurrentNativeToken => ({ id: String(row.id), name: row.name, userId: String(row.userId),
  createdAt: time(row.createdAt), expiresAt: row.expiresAt, revoked: row.revoked, scopes: [...row.scopes].sort() });
function nativeFacts(inventory: GitLabNativeInventory, api: GitLabAccessToken[]): ScmCurrentNativeRepository {
  const { credentials, project } = inventory;
  const nativeTokens = credentials.tokens.map(row => ({ id: row.id, name: row.name, userId: row.userId, createdAt: time(row.createdAt),
    expiresAt: row.expiresAt, revoked: row.revoked, scopes: [...row.scopes].sort() }));
  if (credentials.users.some(row => row.userType !== 'project_bot')
    || credentials.memberships.some(row => row.type !== 'ProjectMember' || row.sourceType !== 'Project' || row.sourceId !== project.id))
    throw precondition('GitLab 当前原机器人与成员身份共享或不明确');
  const apiTokens = api.map(token);
  if (jsonHash(sorted(apiTokens)) !== jsonHash(sorted(nativeTokens))) throw precondition('GitLab API 与当前原数据库令牌不一致');
  return { remoteProjectId: project.id, pathWithNamespace: project.pathWithNamespace, createdAt: time(project.createdAt), apiTokens, nativeTokens,
    relatedTokens: nativeTokens.map(row => ({ ...row, scopes: [...row.scopes] })),
    users: credentials.users.map(row => ({ id: row.id, userType: 'project_bot', createdAt: time(row.createdAt), state: row.state })),
    memberships: credentials.memberships.map(row => ({ id: row.id, userId: row.userId, type: 'ProjectMember', sourceType: 'Project',
      sourceId: row.sourceId, createdAt: time(row.createdAt) })) };
}

/** Current native ownership only. It neither reconstructs callbacks nor certifies reclamation. */
export function gitLabNativeOriginsAdapter(rest: Rest, native: Native): ScmCurrentRepositoryOriginsSource {
  return { read: async (_target, originalHistory) => {
    const history = structuredClone(originalHistory);
    if (!history.origins.length || new Set(history.origins.map(row => row.remoteProjectId)).size !== history.origins.length)
      throw precondition('GitLab 当前原仓库范围缺失或重复');
    const repositories: ScmCurrentNativeRepository[] = [];
    let instance: Awaited<ReturnType<Native['observe']>>['before'] | undefined;
    for (const origin of history.origins) {
      const query: GitLabNativeRequest = { projectId: origin.remoteProjectId, pathWithNamespace: origin.pathWithNamespace, createdAt: origin.createdAt,
        tokenIds: [...new Set([...history.credentials.filter(row => row.serviceId === origin.serviceId).map(row => row.remoteTokenId),
          ...history.records.flatMap(row => row.effects.filter(effect => effect.kind === 'credential' && effect.stage === 'returned'
            && effect.remoteProjectId === origin.remoteProjectId && effect.remoteTokenId).map(effect => effect.remoteTokenId!))])] };
      const before = await rest.getProjectDeletionState(origin.remoteProjectId), apiBefore = await rest.listProjectAccessTokens(origin.remoteProjectId);
      const captured = await native.observe(query), inventory = GitLabNativeInventorySchema.parse(captured.inventory);
      const apiAfter = await rest.listProjectAccessTokens(origin.remoteProjectId), after = await rest.getProjectDeletionState(origin.remoteProjectId);
      if (jsonHash(before) !== jsonHash(after) || jsonHash(sorted(apiBefore.map(token))) !== jsonHash(sorted(apiAfter.map(token)))
        || String(before.id) !== inventory.project.id || before.pathWithNamespace !== inventory.project.pathWithNamespace
        || time(before.createdAt) !== time(inventory.project.createdAt) || inventory.project.id !== origin.remoteProjectId
        || inventory.project.pathWithNamespace !== origin.pathWithNamespace || origin.createdAt !== null && time(origin.createdAt) !== time(inventory.project.createdAt)
        || query.tokenIds.some(id => !inventory.credentials.tokens.some(row => row.id === id))) throw precondition('GitLab 当前原仓库或令牌在核对期间变化');
      instance ??= { ...captured.before };
      if (jsonHash(instance) !== jsonHash(captured.before) || jsonHash(instance) !== jsonHash(captured.after)) throw precondition('GitLab 当前原实例在核对期间变化');
      repositories.push(nativeFacts(inventory, apiAfter));
    }
    return { version: 'gitlab-native/19.2.4/v1', before: instance!, after: { ...instance! }, repositories };
  } };
}
