import type { CommitComparison, WorkspaceReady } from '@crewstation/contracts';
import type { GitCommand } from './gitCommand';
import { gitProblem } from './gitCommand';
import { parseCount } from './gitStatus';

/** 固定 H 和 P，用可达关系计数；任何未知都不补 0。 */
export async function compareCommits(git: GitCommand, workspace: WorkspaceReady, targetSha?: string): Promise<CommitComparison> {
  if (!targetSha) return { status: 'undeployed' };
  if (!workspace.headSha) return { status: 'unavailable', reason: '工作树尚无首次提交' };
  try {
    const exists = await git.run(['cat-file', '-e', `${targetSha}^{commit}`]);
    if (exists.exitCode !== 0) return { status: 'unavailable', reason: '容器缺少目标部署的 Git 对象，可补齐历史后重算' };
    if (targetSha === workspace.headSha) return { status: 'equal', ahead: 0, behind: 0 };
    if (workspace.shallow) return { status: 'unavailable', reason: '浅克隆历史不足，请补齐历史后重算' };
    const base = await git.run(['merge-base', workspace.headSha, targetSha]);
    if (base.exitCode === 1) return { status: 'unrelated' };
    if (base.exitCode !== 0) return { status: 'unavailable', reason: gitProblem(base) };
    const ahead = parseCount(await git.checked(['rev-list', '--count', `${targetSha}..${workspace.headSha}`]));
    const behind = parseCount(await git.checked(['rev-list', '--count', `${workspace.headSha}..${targetSha}`]));
    return { status: ahead === 0 ? behind === 0 ? 'equal' : 'behind' : behind === 0 ? 'ahead' : 'diverged', ahead, behind };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}
