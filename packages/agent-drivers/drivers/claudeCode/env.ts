// ← agent-workflow `runtime/claudeCode/spawn.ts` 的 `assembleClaudeEnv`。
//
// 与源的差异：
//  - 源从 `process.env` 全量复制；这里从宿主给的 `baseEnv` 复制 —— TaskRunner 的 ProcessLauncher
//    已经剔除过 runner 私有变量（CS_RUNNER_TOKEN 等）并按降权设置了 HOME/USER；
//  - 不注入 `IS_SANDBOX`：CrewStation 在任务容器内关闭 Claude 内置沙箱（已登记的偏离），
//    但仍**剔除**环境里任何大小写形式的 IS_SANDBOX，让默认关闭状态是确定的（源的同一条理由）；
//  - 同源：设置 `PWD`；Git 身份两项同时非空时才注入四个变量；不设置 `CLAUDE_CONFIG_DIR`
//    （子进程沿用操作者自己的配置根）。

import type { AgentSpawnContext } from '../../contract/spawnPlan';

export function assembleClaudeEnv(ctx: AgentSpawnContext): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx.baseEnv)) {
    if (key.toUpperCase() === 'IS_SANDBOX') continue;
    env[key] = value;
  }
  env.PWD = ctx.cwd;
  applyGitIdentity(env, ctx.gitUserName, ctx.gitUserEmail);
  return env;
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
