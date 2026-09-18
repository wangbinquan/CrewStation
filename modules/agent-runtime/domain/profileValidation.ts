import type { AgentProtocol, ComputeProfileContent } from '@crewstation/contracts';
import { isPlatformSpawnEnv, reservedLaunchArg } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { isReservedEnvName, validateRevisionContent } from './revisionValidation';

const fail = (message: string, field: string) => validation(message, { field });

/**
 * 按协议校验一个档位修订的内容（RFC-006 §5.1）。字段是否适用已由 LaunchSpec 的 superRefine 拒绝；
 * 这里补齐需要跨字段或平台保留表才能判定的规则，再交给启动前内容校验。
 */
export function validateProfileContent(protocol: AgentProtocol, content: ComputeProfileContent): void {
  if (content.launch.protocol !== protocol) throw fail(`档位协议是 ${protocol}，launch.protocol 不能是 ${content.launch.protocol}；换协议请新建档位`, 'content.launch.protocol');
  for (const arg of content.launch.extraArgs) {
    const reserved = reservedLaunchArg(protocol, arg);
    if (reserved) throw fail(`附加参数 ${arg} 与平台装配的 ${reserved} 冲突，不能覆盖`, 'content.launch.extraArgs');
  }
  const configDirEnv = content.launch.configDirEnv;
  if (configDirEnv !== undefined && (isPlatformSpawnEnv(configDirEnv) || isReservedEnvName(configDirEnv))) {
    throw fail(`配置目录变量名 ${configDirEnv} 被平台保留（会与平台注入的变量互相覆盖），请换一个`, 'content.launch.configDirEnv');
  }
  validateTerminalTest(protocol, content);
  validateConfigBinding(protocol, content);
  validateRevisionContent(content);
}

function validateTerminalTest(protocol: AgentProtocol, content: ComputeProfileContent): void {
  if (protocol !== 'terminal') {
    if (content.terminalTest) throw fail('测试命令只用于通用终端协议；已知协议由平台固定测试作业', 'content.terminalTest');
    return;
  }
  if (!content.terminalTest) throw fail('通用终端协议的档位必须配置测试命令与期望输出（C11）', 'content.terminalTest');
  try { new RegExp(content.terminalTest.expect); }
  catch (error) { throw fail(`期望输出不是合法的正则：${error instanceof Error ? error.message : String(error)}`, 'content.terminalTest.expect'); }
}

/** 配置绑定只用于对应的已知协议：通用终端没有平台 CLI 配置合成。 */
function validateConfigBinding(protocol: AgentProtocol, content: ComputeProfileContent): void {
  const kind = content.configFile.kind;
  if (kind === 'none') return;
  if (kind === 'claude-settings' && protocol !== 'claude-code') throw fail('Claude settings.json 绑定只适用于 claude-code 协议', 'content.configFile');
  if (kind === 'opencode-config' && protocol !== 'opencode') throw fail('OpenCode 配置文件绑定只适用于 opencode 协议', 'content.configFile');
}
