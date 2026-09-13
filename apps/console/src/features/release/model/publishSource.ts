import type { BranchDto, TaskId, WorkspaceStatusDto } from '@crewstation/contracts';
import { FullCommitShaSchema } from '@crewstation/contracts';
import type { PublishSource } from '../../../shared/project/releaseSearch';

export interface PublishSnapshot { readonly source: PublishSource; readonly branch: string; readonly commitSha: string; readonly checkedAt: string; readonly taskId?: TaskId }
export function sessionPublishSnapshot(workspace: WorkspaceStatusDto): { snapshot?: PublishSnapshot; problem?: string } {
  if (workspace.status !== 'ready') return { problem: workspace.reason };
  if (workspace.uncommittedCount > 0) return { problem: 'release.prepare.dirty' };
  if (!workspace.branch) return { problem: 'release.prepare.detached' };
  if (!FullCommitShaSchema.safeParse(workspace.headSha).success) return { problem: 'release.prepare.noHead' };
  return { snapshot: { source: 'session', taskId: workspace.taskId, branch: workspace.branch, commitSha: workspace.headSha!, checkedAt: workspace.checkedAt } };
}
export function repositoryPublishSnapshot(branches: readonly BranchDto[], selected: string, checkedAt: string): { snapshot?: PublishSnapshot; problem?: string } {
  const branch = branches.find((entry) => entry.name === selected);
  if (!branch || !FullCommitShaSchema.safeParse(branch.headSha).success) return { problem: 'release.prepare.branchChanged' };
  return { snapshot: { source: 'repository', branch: branch.name, commitSha: branch.headSha, checkedAt } };
}

export function publishSourceStillMatches(snapshot: PublishSnapshot, workspace: WorkspaceStatusDto | undefined, branches: readonly BranchDto[]): boolean {
  if (snapshot.source === 'repository') return branches.some((branch) => branch.name === snapshot.branch && branch.headSha === snapshot.commitSha);
  return workspace?.status === 'ready' && workspace.taskId === snapshot.taskId && workspace.branch === snapshot.branch && workspace.headSha === snapshot.commitSha && workspace.uncommittedCount === 0;
}
