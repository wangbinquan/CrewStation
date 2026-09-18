// ← agent-workflow `runtime/opencode/inlineConfig.ts` ＋ `agentInjection.ts` 的 `renderOpencodeAgentEntry`。
// 产物是 `OPENCODE_CONFIG_CONTENT` 的整个对象（JSON.stringify 后进环境变量）。
//
// 与源的差异：
//  - 只有一个 agent 条目（CrewStation 没有 dependsOn 闭包／子代理注入）；
//  - 不发 `plugin` 数组（清单插件面不复制）；
//  - 不发顶层 `permission.external_directory`（工作区边界不复制，见 index.ts）；
//  - `options.outputs` 留空数组：源用它承载 agent 的输出端口声明，CrewStation 的输出契约
//    由 TaskRunner 的 verifyContract 校验，不进 CLI。

import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { renderOpencodeMcpInjection } from '../../injection/mcpInjection';
import { opencodePermissionFor } from '../../permission/opencodePermission';
import { OPENCODE_AGENT_NAME } from './argv';

export interface OpencodeInlineConfig {
  agent: Record<string, Record<string, unknown>>;
  mcp?: Record<string, Record<string, unknown>>;
}

/** 一个 agent 条目。`model` 只在非空时出现，为空则让 opencode 用自己的默认。 */
export function renderOpencodeAgentEntry(ctx: AgentSpawnContext): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    prompt: ctx.systemPrompt ?? '',
    description: 'CrewStation 开发会话 Agent',
    // 权限 map 原样写入；opencode 的 `--auto` 只处理没人声明过的操作。
    permission: opencodePermissionFor(ctx.permission),
    // 平台私有字段放 options 下，opencode 原样透传不解析。
    options: { outputs: [] },
  };
  if (ctx.model !== undefined && ctx.model.length > 0) entry.model = ctx.model;
  // RFC-006：档位的 opencode 生成参数，与 agent-workflow agentInjection.ts 的 inlineAgent 写法一致；未设置的键不出现。
  const params = ctx.opencode;
  if (params?.variant !== undefined) entry.variant = params.variant;
  if (params?.temperature !== undefined) entry.temperature = params.temperature;
  if (params?.steps !== undefined) entry.steps = params.steps;
  if (params?.maxSteps !== undefined) entry.maxSteps = params.maxSteps;
  return entry;
}

/** 内联配置整体；`mcp` 键在没有启用条目时整体省略（也避免遮蔽仓库 `.opencode/config.json` 的同名条目）。 */
export function buildOpencodeInlineConfig(ctx: AgentSpawnContext, agentName = OPENCODE_AGENT_NAME): OpencodeInlineConfig {
  const config: OpencodeInlineConfig = { agent: { [agentName]: renderOpencodeAgentEntry(ctx) } };
  const mcp = renderOpencodeMcpInjection(ctx.mcps);
  if (mcp.entries !== null) config.mcp = mcp.entries;
  return config;
}
