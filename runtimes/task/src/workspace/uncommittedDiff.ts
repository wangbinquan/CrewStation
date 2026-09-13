import type { ComparisonFile, WorkspaceReady } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { FileComparisonDeps } from './untrackedDiff';
import { untrackedDiff } from './untrackedDiff';
import { diffOptions } from './gitDiff';
import { workspaceFiles } from './workspaceFiles';
import { gitProblem } from './gitCommand';

export async function uncommittedFiles(deps: FileComparisonDeps, workspace: WorkspaceReady): Promise<ComparisonFile[]> {
  const files = workspace.headSha ? await workspaceFiles(deps, workspace.headSha) : [];
  if (!workspace.headSha) {
    for (const file of workspace.uncommitted) {
      if (file.worktree === 'D') continue;
      const net = await untrackedDiff(deps, undefined, file.path);
      if (net.file) files.push(net.file);
    }
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  // 暂存与未暂存恰好互相抵消时，对 HEAD 的净 diff 是空，但不能从未提交列表消失。
  return workspace.uncommitted.map((file) => ({
    path: file.path, ...(file.originalPath ? { originalPath: file.originalPath } : {}),
    additions: 0, deletions: 0, binary: false, ...byPath.get(file.path), status: file.status, untracked: file.status === 'untracked',
  }));
}

export async function uncommittedPatch(deps: FileComparisonDeps, workspace: WorkspaceReady, file: ComparisonFile): Promise<{ text: string; truncated: boolean }> {
  const ref = workspace.headSha ? [workspace.headSha] : [];
  const paths = [file.path, ...(file.originalPath ? [file.originalPath] : [])].map((path) => `:(literal)${path}`);
  const staged = await deps.git.run(['diff', ...diffOptions, '--cached', '--unified=3', ...ref, '--', ...paths]);
  const unstaged = file.untracked ? (await untrackedDiff(deps, undefined, file.path, true)).output : await deps.git.run(['diff', ...diffOptions, '--unified=3', '--', ...paths]);
  if (staged.exitCode !== 0) throw new RunnerCommandError('git_diff_failed', gitProblem(staged));
  if (unstaged.exitCode !== 0 && !(file.untracked && unstaged.exitCode === 1)) throw new RunnerCommandError('git_diff_failed', gitProblem(unstaged));
  return { text: `# Staged changes\n${staged.stdout}\n# Unstaged / untracked changes\n${unstaged.stdout}`, truncated: staged.truncated || unstaged.truncated };
}
