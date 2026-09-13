import type { ComparisonFile } from '@crewstation/contracts';
import type { GitOutput } from './gitCommand';
import { gitProblem } from './gitCommand';
import { diffOptions, trackedDiff } from './gitDiff';
import type { FileComparisonDeps } from './untrackedDiff';
import { untrackedDiff } from './untrackedDiff';
import { RunnerCommandError } from '../commandError';

/** 目标树对实际工作树的净差异，叠加 untracked 内容后按路径去重；不是提交文件数加 dirty 数。 */
export async function workspaceFiles(deps: FileComparisonDeps, ref: string): Promise<ComparisonFile[]> {
  const tracked = await trackedDiff(deps.git, ref);
  const files = new Map(tracked.map((entry) => [entry.path, entry]));
  const untracked = (await deps.git.checked(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  for (const path of untracked) {
    const { file } = await untrackedDiff(deps, ref, path);
    files.delete(path);
    if (file) files.set(path, file);
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function workspacePatch(deps: FileComparisonDeps, ref: string, file: ComparisonFile): Promise<GitOutput> {
  if (file.untracked) return (await untrackedDiff(deps, ref, file.path, true)).output;
  const paths = [file.path, ...(file.originalPath ? [file.originalPath] : [])].map((path) => `:(literal)${path}`);
  const output = await deps.git.run(['diff', ...diffOptions, '--unified=3', ref, '--', ...paths]);
  if (output.exitCode !== 0) throw new RunnerCommandError('git_diff_failed', gitProblem(output));
  return output;
}
