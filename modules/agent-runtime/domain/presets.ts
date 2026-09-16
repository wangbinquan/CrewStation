import type { RuntimeConfigPreset, RuntimeDriver } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { RuntimeRevisionContent } from './runtimeConfig';

/**
 * 建档预设：最小可运行示例。Claude 用 settings.json 的 env 段承载网关与认证；OpenCode 用 provider.options。
 * 凭据只声明名字，值由管理员单独写入；模板不含任何明文。
 */
export function presetContent(preset: RuntimeConfigPreset, driver: RuntimeDriver): RuntimeRevisionContent {
  if (preset === 'blank') return { steps: [], vars: {}, secretNames: [], configFile: { kind: 'none' }, models: [] };
  if (preset === 'claude-settings') {
    if (driver !== 'claude-code') throw validation('Claude settings.json 预设只适用于 claude-code');
    const pathTemplate = '{{agent.home}}/.claude/settings.json';
    return {
      steps: [{ kind: 'file', stepId: 'claude-settings', name: 'Claude settings.json', pathTemplate, format: 'json', mode: 0o600, existing: 'require-same',
        contentTemplate: JSON.stringify({ env: { ANTHROPIC_BASE_URL: '{{vars.ANTHROPIC_BASE_URL}}', ANTHROPIC_AUTH_TOKEN: '{{secrets.ANTHROPIC_AUTH_TOKEN}}' } }, null, 2) }],
      vars: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, secretNames: ['ANTHROPIC_AUTH_TOKEN'],
      configFile: { kind: 'claude-settings', pathTemplate }, models: [],
    };
  }
  if (driver !== 'opencode') throw validation('OpenCode opencode.json 预设只适用于 opencode');
  const pathTemplate = '{{agent.home}}/.opencode/opencode.json';
  return {
    steps: [{ kind: 'file', stepId: 'opencode-config', name: 'OpenCode opencode.json', pathTemplate, format: 'json', mode: 0o600, existing: 'require-same',
      contentTemplate: JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { anthropic: { options: { baseURL: '{{vars.ANTHROPIC_BASE_URL}}', apiKey: '{{secrets.ANTHROPIC_API_KEY}}' } } } }, null, 2) }],
    vars: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, secretNames: ['ANTHROPIC_API_KEY'],
    configFile: { kind: 'opencode-config', pathTemplate }, models: [],
  };
}
