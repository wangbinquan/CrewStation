import { RunnerResultPayloads } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { ExecSupervisor } from '../exec/execSupervisor';

export interface GitOutput { exitCode: number | null; stdout: string; stderr: string; truncated: boolean }
export interface GitCommand {
  run(args: string[], options?: { env?: Record<string, string>; timeoutSeconds?: number }): Promise<GitOutput>;
  checked(args: string[]): Promise<string>;
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
      const out = await run(args);
      if (out.exitCode !== 0) throw new RunnerCommandError('git_failed', gitProblem(out));
      if (out.truncated) throw new RunnerCommandError('git_output_limit', 'Git 结果超过读取上限，无法给出完整检查结果');
      return out.stdout;
    },
  };
}

export function gitProblem(output: GitOutput): string {
  // Git 可在错误里包含认证 URL。保留具体原因，去掉 URL 的 userinfo。
  const detail = output.stderr.replace(/(https?:\/\/)[^\s/@]+@/g, '$1').trim().slice(0, 600);
  return `Git 检查失败（exit ${output.exitCode ?? 'signal'}）${detail ? `：${detail}` : ''}`;
}
