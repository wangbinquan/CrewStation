import { copyFile, lstat, open, rename, rm } from 'node:fs/promises';
import { relative } from 'node:path';
import type { CommitWorkspaceInput, CommitWorkspaceResult, WorkspaceReady } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import type { GitCommand } from './gitCommand';
import { gitProblem, gitWithin } from './gitCommand';
import { readWorkspaceStatus } from './workspaceStatus';

interface Deps { git: GitCommand; paths: WorkdirPaths; launcher: Pick<ProcessLauncher, 'chownToWorker'> }
const refuse = (message: string): never => { throw new RunnerCommandError('workspace_changed', message); };

/**
 * 开发容器内的显式提交。持有标准 index.lock，候选 index 不覆盖原暂存区；只把确认的路径加入候选。
 * 二次核对指纹后，以 old HEAD CAS 更新当前分支。工作树从不回写，提交后的新编辑仍为 dirty。
 * 回执丢失时调用方必须重读；原 HEAD 前置条件保证重发旧确认不会产生第二次提交。
 */
export async function commitWorkspace(source: Deps, input: CommitWorkspaceInput & { actorUserId: string }): Promise<CommitWorkspaceResult> {
  const deps = { ...source, git: gitWithin(source.git, 60_000) }, { git, paths, launcher } = deps;
  const directory = (await git.checked(['rev-parse', '--absolute-git-dir'])).trim();
  // 外部 worktree / .git 链接不在此快捷入口的安全边界内。
  const gitdir = await paths.resolveRelative(relative(paths.root, directory));
  const index = `${gitdir.absolute}/index`, lockPath = `${index}.lock`, candidate = `${gitdir.absolute}/cs-confirm-${crypto.randomUUID()}`;
  const lock = await open(lockPath, 'wx').catch(() => refuse('Git 正在处理其他操作，请稍后重新检查改动'));
  let committed: string | undefined;
  try {
    await assertNoOperation(gitdir.absolute);
    const before = await confirmed(deps, input);
    await copyFile(index, candidate); await launcher.chownToWorker(candidate);
    const staged = withIndex(git, candidate), files = [...new Set(before.uncommitted.map(file => file.path))];
    await staged.checked(['--literal-pathspecs', 'add', '-A', '--', ...files]);
    const tree = (await staged.checked(['write-tree'])).trim();
    await confirmed(deps, input);
    const author = `CrewStation ${input.actorUserId}`, email = `${input.actorUserId}@users.crewstation.invalid`;
    const result = await git.run(['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', input.expectedHead, '-m', input.message],
      { env: { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: email } });
    if (result.exitCode !== 0 || result.truncated) throw new RunnerCommandError('commit_failed', gitProblem(result));
    const sha = result.stdout.trim();
    if (!/^[a-f0-9]{40,64}$/.test(sha)) refuse('Git 未返回有效提交，请重新检查工作区');
    if ((await git.checked(['symbolic-ref', 'HEAD'])).trim() !== `refs/heads/${input.expectedBranch}`) refuse('当前分支已变化，请重新检查');
    await git.checked(['update-ref', '-m', 'CrewStation confirmed workspace commit', `refs/heads/${input.expectedBranch}`, sha, input.expectedHead]);
    committed = sha;
    await rename(candidate, index);
    return { commitSha: sha, branch: input.expectedBranch, workspace: await readWorkspaceStatus(git, paths) };
  } catch (error) {
    if (committed) throw new RunnerCommandError('commit_result_unknown', `已生成提交 ${committed}，但工作区收尾未确认；请重新读取，不要重复提交。`);
    throw error;
  } finally {
    await lock.close(); await rm(lockPath, { force: true }); await rm(candidate, { force: true });
  }
}

async function confirmed(deps: Deps, input: CommitWorkspaceInput): Promise<WorkspaceReady> {
  const status = await readWorkspaceStatus(deps.git, deps.paths);
  if (status.status !== 'ready') return refuse(status.reason);
  if (status.headSha !== input.expectedHead || status.branch !== input.expectedBranch || status.fingerprint !== input.expectedFingerprint) return refuse('工作区内容、分支或 HEAD 已变化，请重新查看并确认');
  if (!status.uncommittedCount || status.uncommittedTruncated || status.uncommitted.length !== status.uncommittedCount || status.uncommitted.some(file => file.status === 'conflict')) return refuse('没有可完整确认的改动，或存在冲突，请在高级工作区处理');
  for (const file of status.uncommitted) {
    const info = await lstat(`${deps.paths.root}/${file.path}`).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (info?.isDirectory()) return refuse('目录或子模块改动请在高级工作区提交');
  }
  return status;
}
function withIndex(git: GitCommand, index: string): GitCommand {
  const run: GitCommand['run'] = (args, options) => git.run(args, { ...options, env: { ...options?.env, GIT_INDEX_FILE: index } });
  return { run, checked: async args => { const out = await run(args); if (out.exitCode !== 0 || out.truncated) throw new RunnerCommandError('commit_failed', gitProblem(out)); return out.stdout; } };
}
async function assertNoOperation(directory: string) {
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
    if (await lstat(`${directory}/${name}`).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; })) refuse('Git 合并或变基尚未完成，请先在高级工作区处理');
  }
}
