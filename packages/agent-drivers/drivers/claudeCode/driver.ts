import { claudeNativeAgents, stageNativeMaterials } from '../../injection/nativeMaterials';
import { BusinessNativeConfigSchema, BusinessMaterialRequestSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { createClaudeUsageMeter } from '../usage/claudeMeter';
import { stageBusinessSkills, nativeSkillRoots } from '../../injection/businessSkills';
// ← agent-workflow `runtime/claudeCode/driver.ts` 的装配段（`assembleClaudePersonaSpawn` ＋
// `writeClaudeMcpConfig`）。源里的 business 路径、边界、skill 投影、子代理注入、会话捕获、
// 模型表都不复制。RFC-040 的业务材料由独立、受版本约束的合同注入。
//
// 每次运行写出的文件：
//   <runDir>/system.md          —— `--append-system-prompt-file` 的内容
//   <runDir>/mcp-config.json    —— 目录 0o700、文件 0o600
// 用文件而不是内联 JSON 传 MCP 配置，是源里记录过的教训：内联到 argv 会把凭据漏进 /proc/<pid>/cmdline。

import type { KnownAgentProtocol } from '@crewstation/contracts';
import type { CliAgentDriver, DriverAgentSpec, DriverLaunchContext } from '../../contract/agentDriver';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { launchSpawnFields, toMcpServerSpec } from '../../contract/spawnPlan';
import { assertLaunchForKnownProtocol } from '../../injection/launchArgs';
import { createRunDirectory, defaultRunDir } from '../../process/runDirectory';
import type { CliRuntimeAdapter, PreparedRuntime } from '../cliRuntimeAdapter';
import { createCliAgentDriver } from '../cliAgentDriver';
import { buildClaudeSpawn, claudeModelName, renderClaudeMcpConfig } from './argv';
import { readManagedClaudeSettings, writeMergedClaudeSettings } from './managedSettings';
import { detectClaudeSessionNotFound, parseEvent } from './events';
import { claudeUserMessageFrame } from './streamInput';

export const CLAUDE_PROTOCOL: KnownAgentProtocol = 'claude-code';

/** 二进制与参数来自每次启动的 launch（RFC-006）；适配器只认协议。 */
export function claudeCodeAdapter(): CliRuntimeAdapter {
  return {
    protocol: CLAUDE_PROTOCOL,
    // `claude --help`（2.1.268）：`--input-format <text|stream-json>` 明确支持实时流式输入。
    supportsResidentStream: true,
    prepare: prepareClaude,
  };
}

export function createClaudeCodeDriver(which: (binary: string) => string | null): CliAgentDriver {
  return createCliAgentDriver(claudeCodeAdapter(), which);
}

async function prepareClaude(spec: DriverAgentSpec, context: DriverLaunchContext): Promise<PreparedRuntime> {
  assertLaunchForKnownProtocol(spec.launch);
  BusinessMaterialRequestSchema.parse({ requestKey: 'driver', skills: spec.businessSkills, nativeConfig: spec.businessNativeConfig });
  const checked = spec.businessNativeConfig ? BusinessNativeConfigSchema.parse(spec.businessNativeConfig) : undefined;
  if (checked && checked.protocol !== spec.launch.protocol) throw validation('原生材料协议与档位不符', { code: 'invalid_configuration' });
  if (checked) claudeNativeAgents(checked, claudeModelName(spec.launch.model));
  const runDir = await createRunDirectory(context.runDir ?? defaultRunDir(spec.agentId), context.host);
  let native: Awaited<ReturnType<typeof stageNativeMaterials>>;
  let skills: Awaited<ReturnType<typeof stageBusinessSkills>>;
  try {
  const names = new Set(spec.mcp.map((mcp) => mcp.name));
  if (checked?.mcp.some((mcp) => names.has(mcp.name))) throw validation('原生 MCP 与平台连接重名', { code: 'invalid_configuration' });
  const base = baseContext(spec, context, runDir.path);
  native = await stageNativeMaterials(checked, runDir.path, context.host, spec.businessMaterialDownloads ?? [], context.signal);
  const systemPromptFile = await runDir.write('system.md', spec.systemPrompt ?? '');
  const mcp = renderClaudeMcpConfig(base);
  const mcpConfigFile = mcp === null ? undefined : await runDir.write('mcp-config.json', mcp.json);
  // RFC-004：管理员 settings.json 经唯一的 --settings 传入；headless 没有平台观测 hooks 要合成。
  const settingsFile = await writeMergedClaudeSettings(runDir, await readManagedClaudeSettings(context.managed), undefined);
  skills = await stageBusinessSkills(spec.businessSkills, context.host, nativeSkillRoots(context.cwd, context.managed?.home ?? context.env.HOME ?? '/', context.env.XDG_CONFIG_HOME), { runDir: runDir.path, downloads: spec.businessMaterialDownloads, signal: context.signal });
  const files = {
    systemPromptFile,
    ...(mcpConfigFile === undefined ? {} : { mcpConfigFile }),
    mcpServerNames: mcp?.names ?? [],
    ...(settingsFile === undefined ? {} : { settingsFile }),
  };
  context.signal?.throwIfAborted();
  return {
    usageMeter: ({ resumed }) => createClaudeUsageMeter({ resumed }),
    plan: (input) => {
      const plan = buildClaudeSpawn(
        {
          ...base,
          prompt: input.prompt,
          ...(input.resumeSessionId === undefined ? {} : { resumeSessionId: input.resumeSessionId }),
          interactiveStream: input.resident,
        },
        files,
      );
      if (skills) plan.cmd.push('--plugin-dir', skills.root);
      for (const plugin of native?.plugins ?? []) plan.cmd.push('--plugin-dir', plugin);
      return plan;
    },
    parseEvent,
    detectSessionNotFound: detectClaudeSessionNotFound,
    encodeStreamFrame: claudeUserMessageFrame,
    dispose: () => { skills?.dispose(); native?.dispose(); runDir.dispose(); },
  };
  } catch (error) { skills?.dispose(); native?.dispose(); runDir.dispose(); throw error; }
}

function baseContext(spec: DriverAgentSpec, context: DriverLaunchContext, runDir: string): AgentSpawnContext {
  return {
    agentId: spec.agentId, businessNativeConfig: spec.businessNativeConfig,
    prompt: '',
    ...(spec.systemPrompt === undefined ? {} : { systemPrompt: spec.systemPrompt }),
    ...launchSpawnFields(spec.launch),
    permission: spec.permission,
    mcps: [...spec.mcp.map(toMcpServerSpec), ...(spec.businessNativeConfig?.mcp ?? [])],
    cwd: context.cwd,
    runDir,
    baseEnv: context.env,
    gitUserName: context.gitUserName ?? null,
    gitUserEmail: context.gitUserEmail ?? null,
    ...(context.managed ? { managed: context.managed } : {}),
  };
}
