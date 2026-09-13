import { RunnerCommandError } from '../commandError';
import type { GitCommand } from './gitCommand';
import { gitProblem } from './gitCommand';

/** 只能由显式动作调用。下载到平台自有引用，不更新 remote refs、FETCH_HEAD、开发分支或文件。 */
export async function fetchComparisonHistory(git: GitCommand, url: string, targetSha?: string): Promise<void> {
  const shallow = (await git.checked(['rev-parse', '--is-shallow-repository'])).trim() === 'true';
  const refs = ['+refs/heads/*:refs/crewstation/comparison/heads/*', ...(targetSha ? [`+${targetSha}:refs/crewstation/comparison/commits/${targetSha}`] : [])];
  const result = await git.run(['fetch', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--refmap=', ...(shallow ? ['--unshallow'] : []), 'cs-comparison', ...refs], {
    timeoutSeconds: 120,
    env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'remote.cs-comparison.url', GIT_CONFIG_VALUE_0: url },
  });
  if (result.exitCode !== 0) throw new RunnerCommandError('comparison_fetch_failed', gitProblem(result));
}
