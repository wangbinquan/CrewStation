import type { AgentProtocol } from '@crewstation/contracts';

/**
 * 档位协议的下拉取值（RFC-006 C6）。用 Record 而不是数组字面量：contracts 里的协议枚举一旦增删，这里会编译失败，
 * 不会出现管理页少一个协议而没人发现。值为 null 只是占位，键才是取值。
 */
const PROTOCOL_KEYS: Readonly<Record<AgentProtocol, null>> = { 'claude-code': null, opencode: null, terminal: null };
export const PROTOCOLS = Object.keys(PROTOCOL_KEYS) as readonly AgentProtocol[];

/** 编辑器里按协议显隐的字段组；与 contracts 的 launchApplicabilityIssues 同一张表（proposal.md §5.1）。 */
export type ProtocolField = 'extraArgs' | 'configDir' | 'isSandbox' | 'model' | 'opencode' | 'configFile' | 'terminalTest';

const FIELDS: Readonly<Record<AgentProtocol, ReadonlySet<ProtocolField>>> = {
  'claude-code': new Set<ProtocolField>(['extraArgs', 'configDir', 'isSandbox', 'model', 'configFile']),
  opencode: new Set<ProtocolField>(['configDir', 'model', 'opencode', 'configFile']),
  terminal: new Set<ProtocolField>(['extraArgs', 'terminalTest']),
};

/** 不适用的字段直接隐藏：管理员看不到就不会以为自己配置生效了。 */
export function showsField(protocol: AgentProtocol, field: ProtocolField): boolean {
  return FIELDS[protocol].has(field);
}

/** 底座镜像预装的两个官方 CLI（C5）；通用终端没有默认值，由管理员填自己镜像里的路径。 */
export function suggestedBinaryPath(protocol: AgentProtocol): string {
  if (protocol === 'claude-code') return '/usr/local/bin/claude';
  if (protocol === 'opencode') return '/usr/local/bin/opencode';
  return '';
}

/** CLI 加载的原生配置文件类型：每种已知协议只有一种；通用终端不绑定。 */
export function configFileKindFor(protocol: AgentProtocol): 'claude-settings' | 'opencode-config' | undefined {
  if (protocol === 'claude-code') return 'claude-settings';
  if (protocol === 'opencode') return 'opencode-config';
  return undefined;
}
