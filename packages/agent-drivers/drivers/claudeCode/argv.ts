// ← agent-workflow `runtime/claudeCode/spawn.ts` 的 argv 段（`buildClaudeSpawn`）。
//
// 平台只拥有产品输入：system prompt、模型、选中的 MCP、显式权限、恢复 id、cwd、Git 身份与 stream-json 传输；
// 机器／项目配置、凭据、插件、skill 与环境发现仍走 Claude Code 自己的规则。
//
// 与源的差异（都在 index.ts 的「不复制」清单里有依据）：
//  - 不写 `settings.json`、不传 `--settings`：CrewStation 在任务容器内关闭 Claude 内置沙箱（已登记的偏离），
//    而源的 settings 文件正是 `sandbox.enabled: true` 的载体；
//  - 不传 `--agents`：子代理闭包属于 agent-workflow 的 DAG 编排面，不复制；
//  - 不传 `--add-dir`、不做 `extraArgs`：CrewStation 没有「自定义 fork 私有 flag」这个产品概念，
//    平台独占 flag 表仍然保留（见 CLAUDE_PLATFORM_OWNED_FLAGS），供将来开放 extraArgs 时复用；
//  - 新增 `--input-format stream-json`：交互式常驻流（见 streamInput.ts）。

import { validation } from '@crewstation/kernel';
import type { AgentSpawnContext, SpawnPlan } from '../../contract/spawnPlan';
import { renderClaudeMcpInjection } from '../../injection/mcpInjection';
import { claudeToolGateFor, claudeToolsValue } from '../../permission/claudeToolGate';
import { opencodePermissionFor } from '../../permission/opencodePermission';
import { assembleClaudeEnv } from './env';

/** 每个平台拉起的 Claude 子进程共用的 headless 传输基线。 */
export const CLAUDE_HEADLESS_BASE_ARGV: readonly string[] = Object.freeze(['-p', '--output-format', 'stream-json', '--verbose']);

/** 交互式常驻流追加的输入侧 flag（`claude --help` 2.1.268：`--input-format <text|stream-json>`）。 */
export const CLAUDE_STREAM_INPUT_ARGV: readonly string[] = Object.freeze(['--input-format', 'stream-json']);

/**
 * 平台装配的 flag。将来若开放「运行时私有 flag」，它们不得被替换掉：
 * 这是 argv 正确性校验，不是执行边界。源里额外含 `--settings`、`--add-dir`，此处一并保留。
 */
export const CLAUDE_PLATFORM_OWNED_FLAGS: ReadonlySet<string> = new Set([
  '-p', '--print', '--output-format', '--input-format', '--verbose', '--model',
  '--append-system-prompt-file', '--append-system-prompt', '--system-prompt', '--system-prompt-file',
  '--mcp-config', '--agents', '--resume', '--continue', '--session-id', '--fork-session',
  '--permission-mode', '--dangerously-skip-permissions', '--tools', '--allowedTools', '--allowed-tools',
  '--disallowedTools', '--disallowed-tools', '--settings', '--add-dir',
]);

export interface ClaudeExplicitPermissionArgv {
  /** 由权限映射得出的内置工具载入集。 */
  tools: string;
  /** 选中的 MCP 命名空间放行模式。 */
  allowedTools?: string;
}

/** 只在作者声明了显式权限时才成立的权限段。 */
export function claudeExplicitPermissionArgv(input: ClaudeExplicitPermissionArgv): string[] {
  return [
    '--permission-mode', 'dontAsk',
    '--tools', input.tools,
    ...(input.allowedTools === undefined ? [] : ['--allowedTools', input.allowedTools]),
  ];
}

/**
 * `<provider>/<model>` → Claude 的模型名。
 * 源把 `RuntimeProfile.model` 原样喂给 `--model`，但 CrewStation 的 Manifest 约定模型写成
 * `<provider>/<model>`（与 opencode 一致），Claude 不认这种前缀，因此在这里剥掉。
 */
export function claudeModelName(model: string | undefined): string | undefined {
  if (model === undefined || model.length === 0) return undefined;
  const slash = model.lastIndexOf('/');
  return slash < 0 ? model : model.slice(slash + 1);
}

export interface ClaudeArgvInput {
  ctx: AgentSpawnContext;
  /** `<runDir>/system.md`，恒有（内容 = 平台 system prompt）。 */
  systemPromptFile: string;
  /** `<runDir>/mcp-config.json`；没有启用的 MCP 时省略。 */
  mcpConfigFile?: string;
  /** 注入的 MCP 名字，用来拼 `--allowedTools mcp__<name>__*`。 */
  mcpServerNames: readonly string[];
}

/** 组装 argv。顺序与源一致：命令头 → 传输基线 → 权限段 → 模型 → system prompt → MCP → resume。 */
export function buildClaudeArgv(input: ClaudeArgvInput): string[] {
  const { ctx } = input;
  const gate = claudeToolGateFor(opencodePermissionFor(ctx.permission));
  const mcpAllowedTools = input.mcpServerNames.map((name) => `mcp__${name}__*`).join(',');
  const cmd = [
    ...(ctx.head ?? ['claude']),
    ...CLAUDE_HEADLESS_BASE_ARGV,
    ...(ctx.interactiveStream === true ? CLAUDE_STREAM_INPUT_ARGV : []),
    // gate 恒非 null：CrewStation 的三档权限一定产出非空 map，于是永远走 dontAsk ＋ 显式载入集，
    // 不会落到源里「无声明 → bypassPermissions」的那条分支。
    ...(gate === null
      ? ['--permission-mode', 'bypassPermissions']
      : claudeExplicitPermissionArgv({
          tools: claudeToolsValue(gate),
          ...(mcpAllowedTools.length > 0 ? { allowedTools: mcpAllowedTools } : {}),
        })),
  ];
  const model = claudeModelName(ctx.model);
  if (model !== undefined) cmd.push('--model', model);
  cmd.push('--append-system-prompt-file', input.systemPromptFile);
  if (input.mcpConfigFile !== undefined) cmd.push('--mcp-config', input.mcpConfigFile);
  if (ctx.resumeSessionId !== undefined && ctx.resumeSessionId.length > 0) cmd.push('--resume', ctx.resumeSessionId);
  return cmd;
}

export interface ClaudeSpawnFiles {
  systemPromptFile: string;
  mcpConfigFile?: string;
  mcpServerNames: readonly string[];
}

/** argv ＋ env ＋ stdin 约定。交互式用常驻流，oneshot 沿用源的「写一次 prompt 后关闭 stdin」。 */
export function buildClaudeSpawn(ctx: AgentSpawnContext, files: ClaudeSpawnFiles): SpawnPlan {
  return {
    cmd: buildClaudeArgv({ ctx, ...files }),
    env: assembleClaudeEnv(ctx),
    stdin: ctx.interactiveStream === true ? { mode: 'stream' } : { mode: 'prompt', data: ctx.prompt },
  };
}

/** MCP 配置文件的内容；没有启用条目时返回 null，调用方据此省略 `--mcp-config`。 */
export function renderClaudeMcpConfig(ctx: AgentSpawnContext): { json: string; names: string[] } | null {
  const render = renderClaudeMcpInjection(ctx.mcps);
  if (render.entries === null) return null;
  return { json: JSON.stringify({ mcpServers: render.entries }), names: render.names };
}

/** oneshot 模式下 prompt 不能为空：Claude 会把空 prompt 当成没有输入并立刻退出。 */
export function assertPromptPresent(prompt: string): void {
  if (prompt.trim().length === 0) throw validation('claude-code oneshot 需要非空 prompt');
}
