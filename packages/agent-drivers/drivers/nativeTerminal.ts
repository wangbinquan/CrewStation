import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DriverLaunchContext } from '../contract/agentDriver';
import type { NativeTerminalSpec, PreparedNativeTerminal } from '../contract/nativeTerminal';
import type { AgentSpawnContext } from '../contract/spawnPlan';
import { toMcpServerSpec } from '../contract/spawnPlan';
import { createRunDirectory, defaultRunDir } from '../process/runDirectory';
import { renderClaudeMcpConfig } from './claudeCode/argv';
import { assembleClaudeEnv } from './claudeCode/env';
import { buildClaudeNativeArgv } from './claudeCode/nativeArgv';
import { OPENCODE_CONFIG_DIR_NAME } from './opencode/env';
import { buildOpencodeNativeEnv } from './opencode/nativeEnv';
import { buildOpencodeNativeArgv } from './opencode/nativeArgv';

/** 只准备原生 argv 与配置；所有进程仍由 Runtime 的降权 PTY 后端拉起。 */
export async function prepareNativeTerminal(spec: NativeTerminalSpec, context: DriverLaunchContext, head?: string[]): Promise<PreparedNativeTerminal> {
  const runDir = await createRunDirectory(context.runDir ?? defaultRunDir(spec.agentId), context.host);
  const ctx: AgentSpawnContext = {
    agentId: spec.agentId, prompt: '', model: spec.model, permission: spec.permission,
    mcps: spec.mcp.map(toMcpServerSpec), cwd: context.cwd, runDir: runDir.path, baseEnv: context.env,
    ...(head ? { head } : {}), ...(spec.systemPrompt ? { systemPrompt: spec.systemPrompt } : {}),
    gitUserName: context.gitUserName ?? null, gitUserEmail: context.gitUserEmail ?? null,
  };
  try {
    if (spec.driver === 'claude-code') {
      const systemPromptFile = await runDir.write('system.md', spec.systemPrompt ?? '');
      const mcp = renderClaudeMcpConfig(ctx);
      const mcpConfigFile = mcp ? await runDir.write('mcp-config.json', mcp.json) : undefined;
      const nativeSessionId = crypto.randomUUID();
      const cmd = buildClaudeNativeArgv(ctx, { systemPromptFile, ...(mcpConfigFile ? { mcpConfigFile } : {}), mcpServerNames: mcp?.names ?? [] }, nativeSessionId);
      return { plan: { cmd, cwd: ctx.cwd, env: assembleClaudeEnv(ctx) }, nativeSessionId, dispose: runDir.dispose };
    }
    const configDir = join(runDir.path, OPENCODE_CONFIG_DIR_NAME);
    await mkdir(join(configDir, 'skills'), { recursive: true, mode: 0o700 });
    await context.host.chownToWorker(configDir);
    await context.host.chownToWorker(join(configDir, 'skills'));
    const env = buildOpencodeNativeEnv(ctx, configDir);
    return { plan: { cmd: buildOpencodeNativeArgv(ctx), cwd: ctx.cwd, env }, dispose: runDir.dispose };
  } catch (error) { runDir.dispose(); throw error; }
}
