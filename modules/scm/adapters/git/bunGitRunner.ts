import { PlatformError, validation } from '@crewstation/kernel';
import type { UrlCredential } from '../../domain/remoteUrl';
import { scrubCredential, splitCredential } from '../../domain/remoteUrl';
import type { GitRunner } from '../../ports/gitRunner';

export interface BunGitRunnerOptions {
  readonly authorName: string;
  readonly authorEmail: string;
  readonly gitBinary?: string;
}

/** 引用名白名单：不能以 `-` 开头（防止被当成选项），不含 `..`、`//`、`@{`、反斜杠，不以 `/`、`.`、`.lock` 结尾。 */
const REF_NAME = /^(?!-)(?!.*(\.\.|\/\/|@\{|\\|\/\.))[A-Za-z0-9._/-]{1,200}$/;

export function assertRefName(name: string): void {
  if (!REF_NAME.test(name) || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock') || name.startsWith('.')) {
    throw validation(`引用名 ${name} 不合法`, { ref: name });
  }
}

/**
 * 以 Bun.spawn 调用 git CLI。凭据从地址里拆出，经 `GIT_CONFIG_*` 环境变量以 `http.extraHeader` 注入，
 * 命令行上只有不带凭据的地址；stderr 进入错误消息前先抹掉凭据。
 */
export function bunGitRunner(options: BunGitRunnerOptions): GitRunner {
  const git = options.gitBinary ?? 'git';
  const run = async (cwd: string, command: string, args: string[], credential?: UrlCredential): Promise<string> => {
    const proc = Bun.spawn([git, ...args], { cwd, env: gitEnv(options, credential), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (exitCode !== 0) {
      throw new PlatformError('unavailable', `git ${command} 失败（exit ${exitCode}）：${scrubCredential(stderr.trim(), credential)}`, { command, exitCode });
    }
    return stdout.trim();
  };
  const head = (workdir: string, branch: string): Promise<string> => run(workdir, 'rev-parse', ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]);
  /** `-c credential.helper=` 清空凭据助手：认证只来自 http.extraHeader，失败时不会去查系统钥匙串或提示输入。 */
  const push = (workdir: string, url: string, branch: string, credential?: UrlCredential): Promise<string> =>
    run(workdir, 'push', ['-c', 'credential.helper=', 'push', '-q', url, `refs/heads/${branch}:refs/heads/${branch}`], credential);
  return {
    initAndPush: async ({ workdir, remoteUrlWithCredential, branch, message }) => {
      assertRefName(branch);
      const { url, credential } = splitCredential(remoteUrlWithCredential);
      await run(workdir, 'init', ['init', '-q', `--initial-branch=${branch}`]);
      await run(workdir, 'add', ['add', '-A']);
      await run(workdir, 'commit', ['commit', '-q', '--no-verify', '--no-gpg-sign', '--allow-empty', '-m', message]);
      await push(workdir, url, branch, credential);
      return { commitSha: await head(workdir, branch) };
    },
    pushBranch: async ({ workdir, remoteUrlWithCredential, branch }) => {
      assertRefName(branch);
      const { url, credential } = splitCredential(remoteUrlWithCredential);
      const commitSha = await head(workdir, branch);
      await push(workdir, url, branch, credential);
      return { commitSha };
    },
    headSha: async (workdir, branch) => {
      assertRefName(branch);
      return head(workdir, branch);
    },
  };
}

function gitEnv(options: BunGitRunnerOptions, credential?: UrlCredential): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: options.authorName,
    GIT_AUTHOR_EMAIL: options.authorEmail,
    GIT_COMMITTER_NAME: options.authorName,
    GIT_COMMITTER_EMAIL: options.authorEmail,
  };
  if (credential) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;
  }
  return env;
}
