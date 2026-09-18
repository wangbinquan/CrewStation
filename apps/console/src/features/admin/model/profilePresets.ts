import type { AgentProtocol } from '@crewstation/contracts';
import type { CredentialOp, StepDraft } from './stepDraft';
import { stepFromDto } from './stepDraft';

/** 新建档位时的启动前预设：只提供一个最小可运行的文件步骤与凭据名，之后与空白一样可以随意增删。 */
export type ProfilePreset = 'claude-settings' | 'opencode-config' | 'blank';

export interface PresetContent {
  readonly steps: StepDraft[];
  readonly vars: Array<{ name: string; value: string }>;
  readonly secretNames: string[];
  readonly credentials: Record<string, CredentialOp>;
  readonly configFileKind: 'none' | 'claude-settings' | 'opencode-config';
  readonly configFilePath: string;
}

export function presetsFor(protocol: AgentProtocol): readonly ProfilePreset[] {
  if (protocol === 'claude-code') return ['claude-settings', 'blank'];
  if (protocol === 'opencode') return ['opencode-config', 'blank'];
  return ['blank'];
}

const CLAUDE_PATH = '{{agent.home}}/.claude/settings.json';
const OPENCODE_PATH = '{{agent.home}}/.opencode/opencode.json';

/** Claude 用 settings.json 的 env 段承载网关与认证；OpenCode 用 provider.options。模板不含任何明文凭据。 */
export function presetContent(preset: ProfilePreset): PresetContent {
  if (preset === 'claude-settings') {
    return {
      steps: [stepFromDto({ kind: 'file', stepId: 'claude-settings', name: 'Claude settings.json', pathTemplate: CLAUDE_PATH, format: 'json', mode: 0o600, existing: 'require-same',
        contentTemplate: JSON.stringify({ env: { ANTHROPIC_BASE_URL: '{{vars.ANTHROPIC_BASE_URL}}', ANTHROPIC_AUTH_TOKEN: '{{secrets.ANTHROPIC_AUTH_TOKEN}}' } }, null, 2) })],
      vars: [{ name: 'ANTHROPIC_BASE_URL', value: 'https://api.anthropic.com' }], secretNames: ['ANTHROPIC_AUTH_TOKEN'], credentials: { ANTHROPIC_AUTH_TOKEN: { op: 'replace', value: '' } },
      configFileKind: 'claude-settings', configFilePath: CLAUDE_PATH,
    };
  }
  if (preset === 'opencode-config') {
    return {
      steps: [stepFromDto({ kind: 'file', stepId: 'opencode-config', name: 'OpenCode opencode.json', pathTemplate: OPENCODE_PATH, format: 'json', mode: 0o600, existing: 'require-same',
        contentTemplate: JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { anthropic: { options: { baseURL: '{{vars.ANTHROPIC_BASE_URL}}', apiKey: '{{secrets.ANTHROPIC_API_KEY}}' } } } }, null, 2) })],
      vars: [{ name: 'ANTHROPIC_BASE_URL', value: 'https://api.anthropic.com' }], secretNames: ['ANTHROPIC_API_KEY'], credentials: { ANTHROPIC_API_KEY: { op: 'replace', value: '' } },
      configFileKind: 'opencode-config', configFilePath: OPENCODE_PATH,
    };
  }
  return { steps: [], vars: [], secretNames: [], credentials: {}, configFileKind: 'none', configFilePath: '' };
}
