import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DriverLaunchContext } from '../contract/agentDriver';
import type { NativeTerminalSpec, PreparedNativeTerminal } from '../contract/nativeTerminal';
import type { AgentSpawnContext } from '../contract/spawnPlan';
import { launchSpawnFields, toMcpServerSpec } from '../contract/spawnPlan';
import { assertLaunchForKnownProtocol, assertTerminalArgs } from '../injection/launchArgs';
import { terminalMcpEnv } from '../injection/platformMcp';
import { createRunDirectory, defaultRunDir } from '../process/runDirectory';
import { renderClaudeMcpConfig } from './claudeCode/argv';
import { assembleClaudeEnv } from './claudeCode/env';
import { readManagedClaudeSettings, writeMergedClaudeSettings } from './claudeCode/managedSettings';
import { buildClaudeNativeArgv } from './claudeCode/nativeArgv';
import { setupClaudeNativeActivity } from './claudeCode/nativeActivitySetup';
import { opencodeConfigDirName } from './opencode/env';
import { materializeOpencodeConfig } from './opencode/managedConfig';
import { buildOpencodeNativeEnv } from './opencode/nativeEnv';
import { buildOpencodeNativeArgv } from './opencode/nativeArgv';
import { setupOpencodeNativeActivity } from './opencode/nativeActivitySetup';

/** 只准备原生 argv 与配置；所有进程仍由 Runtime 的降权 PTY 后端拉起。 */
export async function prepareNativeTerminal(spec: NativeTerminalSpec, context: DriverLaunchContext): Promise<PreparedNativeTerminal> {
  if (spec.launch.protocol === 'terminal') return prepareTerminalProtocol(spec, context);
  assertLaunchForKnownProtocol(spec.launch);
  const runDir = await createRunDirectory(context.runDir ?? defaultRunDir(spec.agentId), context.host);
  const ctx: AgentSpawnContext = {
    agentId: spec.agentId, prompt: '', ...launchSpawnFields(spec.launch), permission: spec.permission,
    mcps: spec.mcp.map(toMcpServerSpec), cwd: context.cwd, runDir: runDir.path, baseEnv: context.env,
    ...(spec.systemPrompt ? { systemPrompt: spec.systemPrompt } : {}),
    gitUserName: context.gitUserName ?? null, gitUserEmail: context.gitUserEmail ?? null,
    ...(context.managed ? { managed: context.managed } : {}),
  };
  try {
    if (spec.launch.protocol === 'claude-code') {
      const systemPromptFile = await runDir.write('system.md', spec.systemPrompt ?? '');
      const mcp = renderClaudeMcpConfig(ctx);
      const mcpConfigFile = mcp ? await runDir.write('mcp-config.json', mcp.json) : undefined;
      const nativeSessionId = crypto.randomUUID();
      const env = assembleClaudeEnv(ctx);
      // 管理员 settings.json 先读（读不到即配置无效），再与平台观测 hooks 合成为唯一的 --settings 文件。
      const admin = await readManagedClaudeSettings(context.managed);
      const activity = await setupClaudeNativeActivity(ctx, context, runDir, env);
      const settingsFile = await writeMergedClaudeSettings(runDir, admin, activity && 'hooks' in activity ? activity.hooks : undefined);
      const cmd = buildClaudeNativeArgv(ctx, { systemPromptFile, ...(mcpConfigFile ? { mcpConfigFile } : {}), mcpServerNames: mcp?.names ?? [], ...(settingsFile ? { settingsFile } : {}) }, nativeSessionId);
      const activityUnavailable = activity && 'unavailable' in activity ? activity.unavailable : undefined;
      return { plan: { cmd, cwd: ctx.cwd, env }, nativeSessionId, ...(activityUnavailable ? { activityUnavailable } : {}), dispose: runDir.dispose };
    }
    const configDir = join(runDir.path, opencodeConfigDirName(ctx));
    await mkdir(join(configDir, 'skills'), { recursive: true, mode: 0o700 });
    await context.host.chownToWorker(configDir);
    await context.host.chownToWorker(join(configDir, 'skills'));
    const env = buildOpencodeNativeEnv(ctx, configDir);
    const activityUnavailable = await setupOpencodeNativeActivity(ctx, context, runDir, env, configDir);
    await materializeOpencodeConfig(env, context.managed, runDir);
    return { plan: { cmd: buildOpencodeNativeArgv(ctx), cwd: ctx.cwd, env }, ...(activityUnavailable ? { activityUnavailable } : {}), dispose: runDir.dispose };
  } catch (error) { runDir.dispose(); throw error; }
}

/**
 * 通用终端协议（RFC-006 C6、C16）：平台不解析输出、不合成配置、没有 Agent 动态，只把二进制与附加参数原样拉起；
 * 平台 MCP 地址与会话令牌作为 CS_MCP_* 环境变量交给 CLI 自己读取。没有运行目录要清理。
 */
function prepareTerminalProtocol(spec: NativeTerminalSpec, context: DriverLaunchContext): PreparedNativeTerminal {
  const cmd = [spec.launch.binaryPath, ...assertTerminalArgs(spec.launch.extraArgs)];
  return { plan: { cmd, cwd: context.cwd, env: { ...context.env, ...terminalMcpEnv(spec.mcp) } }, dispose: () => undefined };
}
