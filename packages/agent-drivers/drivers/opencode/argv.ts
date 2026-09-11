// ← agent-workflow `runtime/opencode/spawn.ts` 的 argv 段（`buildCommand`、`resolveAutoApproveFlag`、
// `MAX_OPENCODE_PROMPT_BYTES`），原样移植。
//
// 形状：`[...head, 'run', '--agent', <name>, '--format', 'json', '--thinking', <autoFlag>,
//        ('--session', <id>)?, '--', <prompt>]`

import { validation } from '@crewstation/kernel';
import { compareSemver, extractVersion } from '../../process/semver';

/** 平台在 opencode 内联配置里登记的 agent 名；`--agent` 必须与配置里的键一致。 */
export const OPENCODE_AGENT_NAME = 'crewstation';

/**
 * opencode ≥ 该版本把 `run --dangerously-skip-permissions` 改名为 `--auto`
 * （纯改名：describe 文案逐字相同，旧拼写被移除而非保留别名）。
 */
export const OPENCODE_AUTO_FLAG_RENAME_VERSION = '1.18.0';

/**
 * 按已探测版本挑 auto-approve flag 的拼写。
 * 未知版本默认用当前拼写 `--auto`，这样没预热过注册表也能拉起当前版本的 opencode；
 * 只有**明确解析出**低于 1.18 的版本才用旧拼写。
 */
export function resolveAutoApproveFlag(binaryVersion: string | null | undefined): '--auto' | '--dangerously-skip-permissions' {
  if (binaryVersion === null || binaryVersion === undefined) return '--auto';
  // 先过 extractVersion：compareSemver 对不可解析输入返回 0（「相等」），直接比会把垃圾当成新版本。
  const parsed = extractVersion(binaryVersion);
  if (parsed === null) return '--auto';
  return compareSemver(parsed, OPENCODE_AUTO_FLAG_RENAME_VERSION) >= 0 ? '--auto' : '--dangerously-skip-permissions';
}

/**
 * Linux 的 execve 把**单个** argv 元素限制在 128 KiB（MAX_ARG_STRLEN，与总量上限 ARG_MAX 无关，
 * 也不能用 ulimit 放宽）。opencode 的 prompt 是位置参数，超限会以 E2BIG 失败、子进程根本起不来，
 * 用户只看到一条裸内核错误。留出余量（argv 其余部分与 env 也计入 ARG_MAX）并在此可读地失败。
 * Claude 不受影响：它的 prompt 走 stdin。
 */
export const MAX_OPENCODE_PROMPT_BYTES = 120 * 1024;

export interface OpencodeArgvInput {
  head?: string[];
  agentName?: string;
  resumeSessionId?: string;
  /** 已探测到的二进制版本，决定 auto-approve flag 的拼写。 */
  binaryVersion?: string | null;
}

export function buildOpencodeArgv(input: OpencodeArgvInput, prompt: string): string[] {
  // 量的是字节而不是码元：CJK 为主的 prompt 大约是 `.length` 的三倍。
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes > MAX_OPENCODE_PROMPT_BYTES) {
    throw validation(
      `prompt 过大：opencode prompt 为 ${promptBytes} 字节，超过 ${MAX_OPENCODE_PROMPT_BYTES} 字节的 argv 上限（Linux 单参数上限 128 KiB）`,
      { promptBytes, limit: MAX_OPENCODE_PROMPT_BYTES },
    );
  }
  const cmd = [
    ...(input.head ?? ['opencode']),
    'run',
    '--agent', input.agentName ?? OPENCODE_AGENT_NAME,
    '--format', 'json',
    // `--thinking` 让 reasoning 事件进入 stdout；没有它 opencode 会把思考块过滤掉。
    '--thinking',
    // auto-approve flag 是**无条件**的：CLI 运行没有权限应答通道，不加就会卡在第一次工具提示上。
    // 拼写按版本门选（见 resolveAutoApproveFlag）。
    resolveAutoApproveFlag(input.binaryVersion),
  ];
  if (input.resumeSessionId !== undefined && input.resumeSessionId.length > 0) {
    cmd.push('--session', input.resumeSessionId);
  }
  // prompt 是 `--` 之后的尾随位置参数，绝不是 `run` 后面的裸位置参数：opencode 顶层解析器是
  // `.strict()`，首字符为 `-` 的裸位置参数会被当成选项扫描，未知选项让它打印 usage 并 exit 1。
  // 走 `--` 之后，prompt 逐字节送达且永不被当作 flag 扫描。这一段必须留在最后。
  cmd.push('--', prompt);
  return cmd;
}
