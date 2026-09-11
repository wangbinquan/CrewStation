// ← agent-workflow `runtime/claudeCode/driver.ts` 的装配段（`assembleClaudePersonaSpawn` ＋
// `writeClaudeMcpConfig`）。源里的 business 路径、边界、skill 投影、子代理注入、会话捕获、
// 模型表都不复制（依据见包根 index.ts）。
//
// 每次运行写出的文件：
//   <runDir>/system.md          —— `--append-system-prompt-file` 的内容
//   <runDir>/mcp-config.json    —— 目录 0o700、文件 0o600
// 用文件而不是内联 JSON 传 MCP 配置，是源里记录过的教训：内联到 argv 会把凭据漏进 /proc/<pid>/cmdline。

import type { AgentDriver as AgentDriverName } from '@crewstation/contracts';
import type { CliAgentDriver, DriverAgentSpec, DriverLaunchContext } from '../../contract/agentDriver';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { toMcpServerSpec } from '../../contract/spawnPlan';
import { pickRuntimeHead } from '../../injection/spawnHead';
import { createRunDirectory, defaultRunDir } from '../../process/runDirectory';
import type { CliAdapterOptions, CliRuntimeAdapter, PreparedRuntime } from '../cliRuntimeAdapter';
import { createCliAgentDriver } from '../cliAgentDriver';
import { buildClaudeSpawn, renderClaudeMcpConfig } from './argv';
import { detectClaudeSessionNotFound, parseEvent } from './events';
import { claudeUserMessageFrame } from './streamInput';

export const CLAUDE_DRIVER_NAME: AgentDriverName = 'claude-code';
export const CLAUDE_BINARY = 'claude';

export function claudeCodeAdapter(options: CliAdapterOptions = {}): CliRuntimeAdapter {
  const head = pickRuntimeHead(options.binaryPath, [CLAUDE_BINARY]);
  return {
    name: CLAUDE_DRIVER_NAME,
    binary: head[0] ?? CLAUDE_BINARY,
    // `claude --help`（2.1.268）：`--input-format <text|stream-json>` 明确支持实时流式输入。
    supportsResidentStream: true,
    prepare: (spec, context) => prepareClaude(spec, context, head),
  };
}

export function createClaudeCodeDriver(which: (binary: string) => string | null, options: CliAdapterOptions = {}): CliAgentDriver {
  return createCliAgentDriver(claudeCodeAdapter(options), which);
}

async function prepareClaude(spec: DriverAgentSpec, context: DriverLaunchContext, head: string[]): Promise<PreparedRuntime> {
  const runDir = await createRunDirectory(context.runDir ?? defaultRunDir(spec.agentId), context.host);
  const base = { ...baseContext(spec, context, runDir.path), head };
  const systemPromptFile = await runDir.write('system.md', spec.systemPrompt ?? '');
  const mcp = renderClaudeMcpConfig(base);
  const mcpConfigFile = mcp === null ? undefined : await runDir.write('mcp-config.json', mcp.json);
  const files = {
    systemPromptFile,
    ...(mcpConfigFile === undefined ? {} : { mcpConfigFile }),
    mcpServerNames: mcp?.names ?? [],
  };
  return {
    plan: (input) =>
      buildClaudeSpawn(
        {
          ...base,
          prompt: input.prompt,
          ...(input.resumeSessionId === undefined ? {} : { resumeSessionId: input.resumeSessionId }),
          interactiveStream: input.resident,
        },
        files,
      ),
    parseEvent,
    detectSessionNotFound: detectClaudeSessionNotFound,
    encodeStreamFrame: claudeUserMessageFrame,
    dispose: () => runDir.dispose(),
  };
}

function baseContext(spec: DriverAgentSpec, context: DriverLaunchContext, runDir: string): AgentSpawnContext {
  return {
    agentId: spec.agentId,
    prompt: '',
    ...(spec.systemPrompt === undefined ? {} : { systemPrompt: spec.systemPrompt }),
    model: spec.model,
    permission: spec.permission,
    mcps: spec.mcp.map(toMcpServerSpec),
    cwd: context.cwd,
    runDir,
    baseEnv: context.env,
    gitUserName: context.gitUserName ?? null,
    gitUserEmail: context.gitUserEmail ?? null,
  };
}
