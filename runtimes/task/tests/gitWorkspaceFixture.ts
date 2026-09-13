import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noopLogger } from '@crewstation/kernel';
import { createExecSupervisor } from '../src/exec/execSupervisor';
import { createWorkdirPaths } from '../src/files/workdirPath';
import { createProcessLauncher } from '../src/process/launcher';
import { createGitCommand } from '../src/workspace/gitCommand';
import { readWorkspaceStatus } from '../src/workspace/workspaceStatus';

/** 每例用真实临时仓库；不依赖开发者的 Git 身份、默认分支或签名配置。 */
export async function gitWorkspaceFixture(initialize = true) {
  const root = await mkdtemp(join(tmpdir(), 'cs-workspace-git-'));
  const paths = await createWorkdirPaths(root);
  const launcher = createProcessLauncher({
    isolation: { enabled: false, uid: 10001, gid: 10001, wrap: (args) => args },
    processEnv: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, workerHome: root, logger: noopLogger,
  });
  const execs = createExecSupervisor({ launcher, paths, emit: () => {}, logger: noopLogger });
  const git = createGitCommand(execs);
  if (initialize) {
    await git.checked(['init', '-b', 'main']);
    await git.checked(['config', 'user.name', 'Workspace Test']);
    await git.checked(['config', 'user.email', 'test@example.invalid']);
  }
  const write = async (path: string, text: string | Uint8Array): Promise<void> => { await Bun.write(join(root, path), text); };
  const commit = async (subject: string): Promise<string> => {
    await git.checked(['add', '.']);
    await git.checked(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', subject]);
    return (await git.checked(['rev-parse', 'HEAD'])).trim();
  };
  return { root, paths, git, write, commit, status: () => readWorkspaceStatus(git, paths), dispose: async () => { await execs.cancelAll(); await rm(root, { recursive: true, force: true }); } };
}
