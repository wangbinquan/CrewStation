import type { RunnerWorkspaceStatus, WorkspaceReady, WorkspaceUnpushed, WorkspaceUpstream } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { GitCommand } from './gitCommand';
import { parseCount, parseWorkspaceCommits, parseWorkspaceFiles } from './gitStatus';
import { workspaceFingerprint } from './workspaceFingerprint';
import { gitWithin } from './gitCommand';

export const WORKSPACE_FILE_LIMIT = 500;
export const WORKSPACE_COMMIT_LIMIT = 100;
const statusArgs = ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'];

/** 一次非原子的只读检查；期间 Git HEAD/index/路径状态变化则拒绝把混合结果标为 ready。 */
export async function readWorkspaceStatus(source: GitCommand, paths: WorkdirPaths): Promise<RunnerWorkspaceStatus> {
  const git = gitWithin(source, 30_000);
  try {
    const raw = await git.checked(statusArgs);
    const files = parseWorkspaceFiles(raw);
    const header = (key: string): string | undefined => raw.split('\0').find((part) => part.startsWith(`# branch.${key} `))?.slice(key.length + 10);
    const oid = header('oid');
    const branchName = header('head');
    if (!oid || !branchName) throw new RunnerCommandError('git_status_invalid', 'Git 没有返回当前 HEAD 与分支');
    const headSha = oid === '(initial)' ? null : oid;
    const branch = branchName === '(detached)' ? null : branchName;
    const shallow = (await git.checked(['rev-parse', '--is-shallow-repository'])).trim() === 'true';
    const fingerprint = await workspaceFingerprint(paths, raw, files, git.deadline);
    const [unpushed, upstream] = await Promise.all([readUnpushed(git, headSha, shallow), readUpstream(git, headSha, header('upstream'), shallow)]);
    if (raw !== await git.checked(statusArgs)) throw new RunnerCommandError('workspace_changed', '检查期间工作树发生变化，请重新检查');
    return {
      status: 'ready', headSha, branch, shallow, fingerprint,
      uncommitted: files.slice(0, WORKSPACE_FILE_LIMIT), uncommittedCount: files.length, uncommittedTruncated: files.length > WORKSPACE_FILE_LIMIT,
      unpushed, upstream, checkedAt: new Date().toISOString(),
    } satisfies WorkspaceReady;
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
  }
}

async function readUnpushed(git: GitCommand, head: string | null, shallow: boolean): Promise<WorkspaceUnpushed> {
  if (!head) return { status: 'ready', count: 0, commits: [], truncated: false };
  if (shallow) return { status: 'unavailable', reason: '浅克隆历史不完整，不能确认未推送提交数' };
  try {
    const refs = ['HEAD', '--branches', '--not', '--remotes'];
    const count = parseCount(await git.checked(['rev-list', '--count', ...refs]));
    const commits = parseWorkspaceCommits(await git.checked(['log', `--max-count=${WORKSPACE_COMMIT_LIMIT}`, '--format=%H%x00%s', '-z', ...refs]));
    return { status: 'ready', count, commits, truncated: count > commits.length };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function readUpstream(git: GitCommand, head: string | null, name: string | undefined, shallow: boolean): Promise<WorkspaceUpstream> {
  if (!head || !name) return { status: 'missing' };
  if (shallow) return { status: 'unavailable', reason: '浅克隆历史不完整，暂不可计算上游差距' };
  try {
    const headSha = (await git.checked(['rev-parse', '--verify', '@{upstream}^{commit}'])).trim();
    const counts = (await git.checked(['rev-list', '--left-right', '--count', `${head}...${headSha}`])).trim().split(/\s+/);
    return { status: 'ready', name, headSha, ahead: parseCount(counts[0] ?? ''), behind: parseCount(counts[1] ?? '') };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
  }
}
