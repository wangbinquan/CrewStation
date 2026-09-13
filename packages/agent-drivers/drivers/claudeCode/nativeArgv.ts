import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { claudeToolGateFor } from '../../permission/claudeToolGate';
import { opencodePermissionFor } from '../../permission/opencodePermission';
import { claudeModelName } from './argv';

/** claude 2.1.268 --help：缺省交互 TUI，-p 仅用于 headless。原生问题由 CLI 自己接收回答。 */
export function buildClaudeNativeArgv(ctx: AgentSpawnContext, files: { systemPromptFile: string; mcpConfigFile?: string; mcpServerNames: readonly string[] }, sessionId: string): string[] {
  const permission = opencodePermissionFor(ctx.permission);
  const tools = [...(claudeToolGateFor(permission)?.tools ?? [])];
  const names: string[] = [...tools, ...(ctx.permission === 'read-only' ? [] : ['AskUserQuestion'])];
  const allowed = [...names, ...files.mcpServerNames.map((name) => `mcp__${name}__*`)];
  return [
    ...(ctx.head ?? ['claude']), '--session-id', sessionId,
    '--permission-mode', 'default', '--tools', names.join(','),
    ...(allowed.length ? ['--allowedTools', allowed.join(',')] : []),
    ...(ctx.model ? ['--model', claudeModelName(ctx.model)!] : []),
    '--append-system-prompt-file', files.systemPromptFile,
    ...(files.mcpConfigFile ? ['--mcp-config', files.mcpConfigFile] : []),
  ];
}
