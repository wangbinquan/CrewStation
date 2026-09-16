import { readFile, stat } from 'node:fs/promises';
import { BEFORE_START_LIMITS, EnvNameSchema } from '@crewstation/contracts';
import { BeforeStartFailure } from './failure';
import { fsErrorCode } from '../commandError';

/** 平台保留的变量：脚本输出与普通变量都不得覆盖（与 agent-runtime 的保存校验同一份清单）。 */
export const RESERVED_ENV_NAMES: ReadonlySet<string> = new Set([
  'HOME', 'USER', 'LOGNAME', 'PATH', 'PWD', 'CS_AGENT_ID', 'CS_AGENT_HOME', 'CS_AGENT_RUN_DIR', 'CS_WORKDIR', 'CS_HOOK_ENV_OUT',
  'CS_RUNNER_TOKEN', 'CS_SESSION_URL', 'CS_TASK_ID', 'CS_TRACE_ID', 'CLAUDE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT',
]);
export const RESERVED_ENV_PREFIXES: readonly string[] = ['CS_RUNNER_', 'OTEL_'];

export function isReservedEnvName(name: string): boolean {
  return RESERVED_ENV_NAMES.has(name) || RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * 读取脚本经 CS_HOOK_ENV_OUT 写出的 JSON 字符串映射（RFC-004 §5.1）。
 * 没写文件 = 没有额外变量；格式错误、超限、非法名或保留名一律整体拒绝，不部分应用。
 */
export async function readEnvOutput(path: string, stepId: string): Promise<Record<string, string>> {
  let info;
  try { info = await stat(path); } catch (error) { if (fsErrorCode(error) === 'ENOENT') return {}; throw error; }
  if (info.size > BEFORE_START_LIMITS.maxEnvOutputBytes) throw new BeforeStartFailure('env_output_invalid', `环境输出文件 ${info.size} 字节，超过 ${BEFORE_START_LIMITS.maxEnvOutputBytes} 字节上限`, stepId);
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); } catch { throw new BeforeStartFailure('env_output_invalid', '环境输出文件不是合法 JSON', stepId); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BeforeStartFailure('env_output_invalid', '环境输出必须是 JSON 对象（变量名 → 字符串值）', stepId);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!EnvNameSchema.safeParse(name).success) throw new BeforeStartFailure('env_output_invalid', `变量名 ${name} 不合法`, stepId);
    if (typeof value !== 'string') throw new BeforeStartFailure('env_output_invalid', `变量 ${name} 的值必须是字符串`, stepId);
    if (isReservedEnvName(name)) throw new BeforeStartFailure('reserved_variable', `变量 ${name} 是平台保留名，脚本不能覆盖`, stepId);
    out[name] = value;
  }
  return out;
}
