import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import type { Actor, ProjectDeletionTarget, ServiceId, UserId } from '@crewstation/contracts';
import type { GitLabClient } from '@crewstation/gitlab-client';
import type { NativeScmPort } from './bindings';
import { gitRepositoryIdentity } from '@crewstation/filesystem-metrics';
import type { GitInputExpectation } from '@crewstation/filesystem-metrics';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ReleaseWorkContent } from './bindings';

/** Complete immutable SCM tree at each original release commit. This remains
 * retained when SCM's later stop removes the original remote repository. */
export async function buildKitGitInputs(scm: NativeScmPort, gitlab: GitLabClient, target: ProjectDeletionTarget, content: ReleaseWorkContent): Promise<GitInputExpectation[]> {
  const actor: Actor = { userId: BUILTIN_RESOURCES.systemActor as UserId, isAdmin: true }, result: GitInputExpectation[] = [];
  for (const row of content.buildInputs ?? []) {
    if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(row.commit)) throw precondition('原发布提交缺少完整 SCM 出生身份');
    const binding = await scm.getBinding(actor, row.serviceId as ServiceId), before = await gitlab.getProjectDeletionState(binding.remoteProjectId);
    if (binding.state !== 'ready' || before.pathWithNamespace !== binding.pathWithNamespace || !before.createdAt || target.serviceId && target.serviceId !== row.serviceId) throw precondition('原源码输入的项目、服务或远端出生不符');
    const commit = await gitlab.getCommit(binding.remoteProjectId, row.commit), entries = await gitlab.getRepositoryTree(binding.remoteProjectId, '', { ref: row.commit, recursive: true });
    const after = await gitlab.getProjectDeletionState(binding.remoteProjectId);
    if (commit.id !== row.commit || jsonHash(before) !== jsonHash(after) || !entries.length || new Set(entries.map(entry => entry.path)).size !== entries.length) throw precondition('原 SCM 提交或完整树 EOF 变化');
    if (entries.some(entry => entry.type !== 'tree' && (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(entry.id)))) throw precondition('原 SCM 输入树含暂不支持的链接或子模块，不能误判字节归属');
    const original = { repositoryIdentity: gitRepositoryIdentity(binding.httpUrl), commit: row.commit,
      tree: entries.filter(entry => entry.type === 'blob').map(entry => ({ path: entry.path, mode: entry.mode as '100644' | '100755', blob: entry.id })).sort((a,b) => a.path.localeCompare(b.path)) };
    if (!result.some(value => value.repositoryIdentity === original.repositoryIdentity && value.commit === original.commit)) result.push(original);
  }
  return result;
}
