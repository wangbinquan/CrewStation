// ← agent-workflow `runtime/claudeCode/spawn.ts` 的 `assembleClaudeEnv`。
//
// 与源的差异：
//  - 源从 `process.env` 全量复制；这里从宿主给的 `baseEnv` 复制 —— TaskRunner 的 ProcessLauncher
//    已经剔除过 runner 私有变量（CS_RUNNER_TOKEN 等）并按降权设置了 HOME/USER；
//  - `IS_SANDBOX`：先剔除环境里任何大小写形式，档位显式打开（RFC-006 C12）才注入 `IS_SANDBOX=1`，
//    默认关闭的状态因此是确定的（源的同一条理由）；它只是 Claude CLI 的兼容标记，不启用任何沙箱；
//  - 同源：设置 `PWD`；Git 身份两项同时非空时才注入四个变量；托管模式把配置目录变量指向私有家目录下的
//    配置目录（RFC-004），fork 改名的变量名与目录叶名按档位覆盖（RFC-006，对应源 RFC-154）。

import { join } from 'node:path';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { assertConfigDirEnv } from '../../injection/launchArgs';

/** Claude 协议读取配置目录的默认变量名与目录叶名。 */
export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
export const CLAUDE_CONFIG_DIR_NAME = '.claude';

export function assembleClaudeEnv(ctx: AgentSpawnContext): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx.baseEnv)) {
    if (key.toUpperCase() === 'IS_SANDBOX') continue;
    env[key] = value;
  }
  env.PWD = ctx.cwd;
  if (ctx.isSandbox === true) env.IS_SANDBOX = '1';
  // 托管 Agent 的配置根指向私有家目录下的配置目录，认证缓存不再写进 /work。
  if (ctx.managed) env[claudeConfigDirEnv(ctx)] = join(ctx.managed.home, ctx.configDir?.name ?? CLAUDE_CONFIG_DIR_NAME);
  applyGitIdentity(env, ctx.gitUserName, ctx.gitUserEmail);
  return env;
}

/** 档位覆盖的配置目录变量名；不能与平台注入的环境变量同名。 */
export function claudeConfigDirEnv(ctx: Pick<AgentSpawnContext, 'configDir'>): string {
  return ctx.configDir?.env === undefined ? CLAUDE_CONFIG_DIR_ENV : assertConfigDirEnv(ctx.configDir.env);
}

/** author 与 committer 一起设或一起不设；任一为空则整块跳过，沿用容器里既有的身份解析。 */
export function applyGitIdentity(env: Record<string, string>, name?: string | null, email?: string | null): void {
  const gitName = typeof name === 'string' ? name : '';
  const gitEmail = typeof email === 'string' ? email : '';
  if (gitName.length === 0 || gitEmail.length === 0) return;
  env.GIT_AUTHOR_NAME = gitName;
  env.GIT_AUTHOR_EMAIL = gitEmail;
  env.GIT_COMMITTER_NAME = gitName;
  env.GIT_COMMITTER_EMAIL = gitEmail;
}
