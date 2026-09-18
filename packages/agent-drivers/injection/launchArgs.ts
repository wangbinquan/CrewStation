// ← agent-workflow `services/runtimeRegistry.ts` 的 `validateExtraArgs`（RFC-143／2026-08-04 fork 部署）与
// RFC-154 的配置目录变量名保留表。保存时平台（agent-runtime）已校验一次；这里在拼 argv／env 前再判一次，
// 旧修订或绕过保存的材料也不能把平台装配的参数、环境变量顶掉。保留表只有一份，在 contracts 的 launch.ts。

import type { LaunchSpec } from '@crewstation/contracts';
import { isPlatformSpawnEnv, reservedLaunchArg } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';

/** 控制字符：参数原样进 argv，换行之类会被 CLI 当成新的一行输入。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function assertTokenShape(token: string): void {
  if (token.trim().length === 0) throw validation('附加参数不能是空白', { code: 'launch_args_invalid' });
  if (CONTROL_CHARS.test(token)) throw validation('附加参数不能含控制字符', { code: 'launch_args_invalid' });
}

/**
 * claude-code 协议的附加参数：平台保留参数（含 `--flag=value`）一律拒绝；
 * 裸值只能紧跟在不带 `=` 的长参数之后，否则会被 CLI 当成 prompt 位置参数（headless）或初始输入（TUI）。
 */
export function assertClaudeExtraArgs(args: readonly string[] | undefined): readonly string[] {
  let previousWasLongFlag = false;
  for (const token of args ?? []) {
    assertTokenShape(token);
    const isFlag = token.startsWith('-');
    if (!isFlag && !previousWasLongFlag) throw validation(`附加参数里的裸值 ${token} 会被当成提示词，值只能紧跟在 --参数 之后`, { code: 'launch_args_invalid' });
    const reserved = isFlag ? reservedLaunchArg('claude-code', token) : undefined;
    if (reserved) throw validation(`${reserved} 由平台装配，不能经附加参数覆盖`, { code: 'launch_args_reserved', flag: reserved });
    previousWasLongFlag = isFlag && token.startsWith('--') && !token.includes('=');
  }
  return args ?? [];
}

/** 通用终端协议：平台不装配任何参数，只挡住空白与控制字符。 */
export function assertTerminalArgs(args: readonly string[] | undefined): readonly string[] {
  for (const token of args ?? []) assertTokenShape(token);
  return args ?? [];
}

/** fork 改名的配置目录变量不能与平台写进每次启动的环境变量同名，否则两套机制互相覆盖、其中一方静默失效。 */
export function assertConfigDirEnv(name: string): string {
  if (isPlatformSpawnEnv(name)) throw validation(`配置目录变量名 ${name} 与平台注入的环境变量冲突，请换一个`, { code: 'config_dir_env_reserved', name });
  return name;
}

/** 两种已知协议在建运行目录之前先整体校验：装配失败只发一条 driver_setup_failed，不留下半个运行目录。 */
export function assertLaunchForKnownProtocol(launch: Pick<LaunchSpec, 'protocol' | 'extraArgs' | 'configDirEnv'>): void {
  if (launch.protocol === 'claude-code') assertClaudeExtraArgs(launch.extraArgs);
  else if ((launch.extraArgs?.length ?? 0) > 0) throw validation(`附加参数只对 claude-code 与 terminal 协议生效，${launch.protocol} 不接受`, { code: 'launch_args_invalid' });
  if (launch.configDirEnv !== undefined) assertConfigDirEnv(launch.configDirEnv);
}
