import type { WorkspaceCommit, WorkspaceFile } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';

/** porcelain v2 -z 的路径不做 trim；重命名第二个 NUL 字段是原路径。 */
export function parseWorkspaceFiles(output: string): WorkspaceFile[] {
  const records = output.split('\0');
  const files: WorkspaceFile[] = [];
  for (let i = 0; i < records.length; i++) {
    const line = records[i] ?? '';
    if (!line || line.startsWith('# ')) continue;
    if (line.startsWith('? ')) {
      files.push({ path: line.slice(2), status: 'untracked', index: '?', worktree: '?' });
      continue;
    }
    const fieldCount = line[0] === '1' ? 8 : line[0] === '2' ? 9 : line[0] === 'u' ? 10 : 0;
    if (!fieldCount) throw new RunnerCommandError('git_status_invalid', '无法识别 Git 工作树状态');
    const fields = line.split(' ');
    const xy = fields[1] ?? '';
    const path = fields.slice(fieldCount).join(' ');
    if (xy.length !== 2 || !path) throw new RunnerCommandError('git_status_invalid', 'Git 工作树状态不完整');
    const originalPath = line[0] === '2' ? records[++i] : undefined;
    if (line[0] === '2' && !originalPath) throw new RunnerCommandError('git_status_invalid', 'Git 重命名状态不完整');
    files.push({ path, status: line[0] === 'u' ? 'conflict' : xy, index: xy[0]!, worktree: xy[1]!, ...(originalPath ? { originalPath } : {}) });
  }
  return files;
}

export function parseWorkspaceCommits(output: string): WorkspaceCommit[] {
  const fields = output.split('\0');
  const commits: WorkspaceCommit[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const sha = fields[i]?.trim();
    if (sha) commits.push({ sha, subject: fields[i + 1] ?? '' });
  }
  return commits;
}

export function parseCount(value: string): number {
  const text = value.trim();
  const count = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(count)) throw new RunnerCommandError('git_count_invalid', 'Git 提交数量无法读取');
  return count;
}
