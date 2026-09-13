import type { ComparisonFile } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { GitCommand } from './gitCommand';
import { parseCount } from './gitStatus';

export const diffOptions = ['--no-ext-diff', '--no-textconv', '--no-color', '--find-renames'];

export async function trackedDiff(git: GitCommand, ref: string): Promise<ComparisonFile[]> {
  const names = parseDiffNames(await git.checked(['diff', ...diffOptions, '--name-status', '-z', ref, '--', '.']));
  const stats = parseDiffStats(await git.checked(['diff', ...diffOptions, '--numstat', '-z', ref, '--', '.']));
  return names.map((entry) => {
    const count = stats.get(entry.path);
    if (!count) throw new RunnerCommandError('workspace_changed', '计算文件差异期间工作树已变化，请重算');
    return { ...entry, ...count, untracked: false };
  });
}

export function parseDiffNames(output: string): Array<Pick<ComparisonFile, 'path' | 'originalPath' | 'status'>> {
  const fields = output.split('\0');
  const result: Array<Pick<ComparisonFile, 'path' | 'originalPath' | 'status'>> = [];
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++] ?? '';
    const first = fields[i++];
    if (!status || !first) throw new RunnerCommandError('git_diff_invalid', 'Git 文件差异不完整');
    const renamed = status.startsWith('R') || status.startsWith('C');
    const path = renamed ? fields[i++] : first;
    if (!path) throw new RunnerCommandError('git_diff_invalid', 'Git 重命名差异不完整');
    result.push({ status, path, ...(renamed ? { originalPath: first } : {}) });
  }
  return result;
}

export function parseDiffStats(output: string): Map<string, Pick<ComparisonFile, 'additions' | 'deletions' | 'binary'>> {
  const fields = output.split('\0');
  const result = new Map<string, Pick<ComparisonFile, 'additions' | 'deletions' | 'binary'>>();
  for (let i = 0; i < fields.length - 1; i++) {
    const record = fields[i] ?? '';
    const firstTab = record.indexOf('\t');
    const secondTab = record.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) throw new RunnerCommandError('git_diff_invalid', 'Git 增删行结果不完整');
    const added = record.slice(0, firstTab), removed = record.slice(firstTab + 1, secondTab);
    let path = record.slice(secondTab + 1);
    if (!path) { i += 2; path = fields[i] ?? ''; }
    if (!path) throw new RunnerCommandError('git_diff_invalid', 'Git 增删行路径不完整');
    const binary = added === '-' || removed === '-';
    result.set(path, { additions: binary ? null : parseCount(added), deletions: binary ? null : parseCount(removed), binary });
  }
  return result;
}
