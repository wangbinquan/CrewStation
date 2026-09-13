import { RunnerResultPayloads } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { ExecSupervisor } from '../exec/execSupervisor';

export interface GitOutput { exitCode: number | null; stdout: string; stderr: string; truncated: boolean }
export interface GitCommand {
  readonly deadline?: number;
  run(args: string[], options?: { env?: Record<string, string>; timeoutSeconds?: number }): Promise<GitOutput>;
  checked(args: string[]): Promise<string>;
}

/** 多条 Git 命令共享一个截止时间；不能让一项比较按文件数无限叠加超时。 */
export function gitWithin(git: GitCommand, durationMs: number): GitCommand {
  const deadline = Math.min(git.deadline ?? Infinity, Date.now() + durationMs);
  const run: GitCommand['run'] = async (args, options) => {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining <= 0) throw new RunnerCommandError('comparison_timeout', '工作树检查或版本比较超时，请缩小改动范围后重试');
    return git.run(args, { ...options, timeoutSeconds: Math.min(options?.timeoutSeconds ?? 30, remaining) });
  };
  return { deadline, run, checked: async (args) => checkedOutput(await run(args)) };
}

function checkedOutput(out: GitOutput): string {
  if (out.exitCode !== 0) throw new RunnerCommandError('git_failed', gitProblem(out));
  if (out.truncated) throw new RunnerCommandError('git_output_limit', 'Git 结果超过读取上限，无法给出完整检查结果');
  return out.stdout;
}

/** 复用 worker 身份、进程树超时与有界输出；不经 shell，不修改 index 的 stat 缓存。 */
export function createGitCommand(execs: ExecSupervisor): GitCommand {
  const run: GitCommand['run'] = async (args, options) => {
    const id = `git-${crypto.randomUUID()}`;
    return RunnerResultPayloads.exec.parse(await execs.run({
      id, execId: id, type: 'exec', command: ['git', '--no-optional-locks', ...args],
      env: { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...options?.env },
      wait: true, timeoutSeconds: options?.timeoutSeconds ?? 30,
    }));
  };
  return {
    run,
    async checked(args) {
      return checkedOutput(await run(args));
    },
  };
}

export function gitProblem(output: GitOutput): string {
  // Git 可在错误里包含认证 URL。保留具体原因，去掉 URL 的 userinfo。
  const detail = output.stderr.replace(/(https?:\/\/)[^\s/@]+@/g, '$1').trim().slice(0, 600);
  return `Git 检查失败（exit ${output.exitCode ?? 'signal'}）${detail ? `：${detail}` : ''}`;
}
