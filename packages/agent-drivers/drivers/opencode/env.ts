// ← agent-workflow `runtime/opencode/spawn.ts` 的 `buildOpencodeEnv`。
//
// 与源的差异：
//  - 不读 `AGENT_WORKFLOW_OPENCODE_BIN`、`OPENCODE_PURE`；
//  - 不设 `OPENCODE_AW_INVENTORY_OUT`（清单插件不复制）；
//  - `configDirEnv` 不再可配置（源为自定义 fork 留的 RFC-154 改名口），固定 `OPENCODE_CONFIG_DIR`，
//    因此源里 `envNameMatches` 那套大小写折叠比较也不需要（POSIX 精确 delete 即可）。

import { validation } from '@crewstation/kernel';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { applyGitIdentity } from '../claudeCode/env';
import { buildOpencodeInlineConfig } from './inlineConfig';

/** opencode 的配置目录环境变量名与目录叶名。 */
export const OPENCODE_CONFIG_DIR_ENV = 'OPENCODE_CONFIG_DIR';
export const OPENCODE_CONFIG_DIR_NAME = '.opencode';
/** opencode 在内联配置**之后**合并这个变量；绝不让宿主环境里的值悄悄改写托管子进程。 */
const SCRUBBED = 'OPENCODE_PERMISSION';
/** 内联配置序列化后的告警阈值（源：超过只告警不失败）。 */
export const OPENCODE_INLINE_CONFIG_WARN_BYTES = 32 * 1024;

export interface OpencodeEnvResult {
  env: Record<string, string>;
  /** 序列化后的内联配置字节数，供调用方在超阈值时告警。 */
  inlineConfigBytes: number;
}

export function buildOpencodeEnv(ctx: AgentSpawnContext, configDir: string): OpencodeEnvResult {
  if (configDir.length === 0) throw validation('opencode 配置目录不能为空');
  const inlineConfigSerialized = JSON.stringify(buildOpencodeInlineConfig(ctx));
  const env: Record<string, string> = {
    ...ctx.baseEnv,
    // opencode 1.14.51+ 用 `process.env.PWD ?? process.cwd()` 解析项目根；
    // spawn 的 `cwd:` 只改工作目录、PWD 仍是父进程继承下来的，不钉死就会加载两个 Instance，
    // `--format json` 的事件也就不再进我们的 stdout 泵。
    PWD: ctx.cwd,
    [OPENCODE_CONFIG_DIR_ENV]: configDir,
    OPENCODE_CONFIG_CONTENT: inlineConfigSerialized,
  };
  delete env[SCRUBBED];
  applyGitIdentity(env, ctx.gitUserName, ctx.gitUserEmail);
  return { env, inlineConfigBytes: Buffer.byteLength(inlineConfigSerialized, 'utf8') };
}
