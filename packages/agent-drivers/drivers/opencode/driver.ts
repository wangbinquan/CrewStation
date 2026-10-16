import { readStartupInventory, renderStartupInventoryPlugin } from './startupInventory';
import { stageNativeMaterials } from '../../injection/nativeMaterials';
import { BusinessNativeConfigSchema, BusinessMaterialRequestSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { createOpencodeUsageMeter } from '../usage/opencodeMeter';
import { stageBusinessSkills, nativeSkillRoots } from '../../injection/businessSkills';
// ← agent-workflow `runtime/opencode/driver.ts` 的装配段（`assembleOpencodePersonaSpawn`）。
// 工作区边界、SQLite 会话捕获、模型列举不复制；RFC-040 独立提供材料物化与启动清单。
// 不复制源里的
// `AGENT_WORKFLOW_OPENCODE_BIN` ／ `OPENCODE_PURE` 环境开关（依据见包根 index.ts）。
//
// 每次运行建出的目录：`<runDir>/.opencode/skills/` —— 即使零个 skill 也要建，
// 源记录过 opencode 1.17+ 在配置目录缺失时会直接 exit 1。

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { KnownAgentProtocol } from '@crewstation/contracts';
import type { CliAgentDriver, DriverAgentSpec, DriverLaunchContext } from '../../contract/agentDriver';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { launchSpawnFields, toMcpServerSpec } from '../../contract/spawnPlan';
import { assertLaunchForKnownProtocol } from '../../injection/launchArgs';
import { createRunDirectory, defaultRunDir } from '../../process/runDirectory';
import type { CliRuntimeAdapter, PreparedRuntime } from '../cliRuntimeAdapter';
import { createCliAgentDriver } from '../cliAgentDriver';
import { OPENCODE_AGENT_NAME, buildOpencodeArgv } from './argv';
import { OPENCODE_INLINE_CONFIG_WARN_BYTES, buildOpencodeEnv, opencodeConfigDirName } from './env';
import { readManagedOpencodeConfig, materializeOpencodeConfig } from './managedConfig';
import { parseEvent } from './events';
import { detectOpencodeSessionNotFound, ensureOpencodeBinaryVersion } from './probe';

export const OPENCODE_PROTOCOL: KnownAgentProtocol = 'opencode';

/** 二进制与参数来自每次启动的 launch（RFC-006）；适配器只认协议。 */
export function opencodeAdapter(): CliRuntimeAdapter {
  return {
    protocol: OPENCODE_PROTOCOL,
    // `opencode run --help`（1.18.29 实测）的 message 是位置参数，没有任何 stdin 流入口：
    // 交互式只能退化为「一轮一进程 ＋ `--session <id>` 续接」。
    supportsResidentStream: false,
    prepare: prepareOpencode,
  };
}

export function createOpencodeDriver(which: (binary: string) => string | null): CliAgentDriver {
  return createCliAgentDriver(opencodeAdapter(), which);
}

async function prepareOpencode(spec: DriverAgentSpec, context: DriverLaunchContext): Promise<PreparedRuntime> {
  assertLaunchForKnownProtocol(spec.launch);
  BusinessMaterialRequestSchema.parse({ requestKey: 'driver', skills: spec.businessSkills, nativeConfig: spec.businessNativeConfig });
  const runDir = await createRunDirectory(context.runDir ?? defaultRunDir(spec.agentId), context.host);
  let native: Awaited<ReturnType<typeof stageNativeMaterials>>;
  let skills: Awaited<ReturnType<typeof stageBusinessSkills>>;
  try {
  const checked = spec.businessNativeConfig ? BusinessNativeConfigSchema.parse(spec.businessNativeConfig) : undefined;
  if (checked && checked.protocol !== spec.launch.protocol) throw validation('原生材料协议与档位不符', { code: 'invalid_configuration' });
  const names = new Set(spec.mcp.map((mcp) => mcp.name));
  if (checked?.mcp.some((mcp) => names.has(mcp.name))) throw validation('原生 MCP 与平台连接重名', { code: 'invalid_configuration' });
  const admin = await readManagedOpencodeConfig(context.managed);
  const managedMcp = admin?.mcp as Record<string, unknown> | undefined;
  const managedAgents = admin?.agent as Record<string, unknown> | undefined;
  if (checked?.mcp.some((entry) => managedMcp && Object.hasOwn(managedMcp, entry.name))) throw validation('业务 MCP 与管理员配置重名', { code: 'invalid_configuration' });
  if (checked && [checked.agent, ...checked.subagents].some((entry) => managedAgents && Object.hasOwn(managedAgents, entry.name))) throw validation('业务 Agent 与管理员配置重名', { code: 'invalid_configuration' });
  const base = baseContext(spec, context, runDir.path);
  native = await stageNativeMaterials(checked, runDir.path, context.host, spec.businessMaterialDownloads ?? [], context.signal);
  const head = [...base.head];
  const configDir = join(runDir.path, opencodeConfigDirName(base));
  mkdirSync(join(configDir, 'skills'), { recursive: true, mode: 0o700 });
  await context.host.chownToWorker(configDir);
  await context.host.chownToWorker(join(configDir, 'skills'));
  const { env, inlineConfigBytes } = buildOpencodeEnv(base, configDir);
  if (inlineConfigBytes > OPENCODE_INLINE_CONFIG_WARN_BYTES) {
    context.logger.warn('opencode 内联配置偏大', { bytes: inlineConfigBytes, limit: OPENCODE_INLINE_CONFIG_WARN_BYTES });
  }
  // RFC-004：管理员 opencode 配置为底、平台叠加层在上，合成为 OPENCODE_CONFIG 指向的单个文件。
  await materializeOpencodeConfig(env, context.managed, runDir);
  // auto-approve flag 的拼写在 1.18.0 改过，拼错会让每次拉起都只剩一整块 usage ＋ exit 1，所以先探版本。
  const binaryVersion = await ensureOpencodeBinaryVersion(context.host, head, { cwd: context.cwd, env: context.env, logger: context.logger });
  const adminSkills = admin?.skills as { paths?: unknown } | undefined;
  const adminPaths = Array.isArray(adminSkills?.paths) ? adminSkills.paths.filter((value): value is string => typeof value === 'string') : [];
  skills = await stageBusinessSkills(spec.businessSkills, context.host, [...nativeSkillRoots(context.cwd, context.managed?.home ?? context.env.HOME ?? '/', context.env.XDG_CONFIG_HOME), ...adminPaths], { runDir: runDir.path, downloads: spec.businessMaterialDownloads, signal: context.signal });
  if (skills) {
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
    config.skills = { ...(config.skills ?? {}), paths: [...new Set([...adminPaths, ...(config.skills?.paths ?? []), skills.skills])] };
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  }
  const inventoryNonce = crypto.randomUUID(), inventoryFile = join(runDir.path, 'startup-inventory.json');
  const configured = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
  if (spec.startupInventoryVersion === 1) {
    const observer = await runDir.write('startup-inventory-observer.mjs', renderStartupInventoryPlugin(inventoryFile, inventoryNonce));
    configured.plugin = [...(configured.plugin ?? []), `file://${observer}`];
  }
  if (native?.plugins.length) configured.plugin = [...native.plugins, ...(configured.plugin ?? [])];
  if (checked) {
    for (const [name, definition] of Object.entries(configured.agent) as Array<[string, Record<string, unknown>]>) if (typeof definition.prompt === 'string') definition.prompt = `{file:${await runDir.write(`agent-${name}.md`, definition.prompt)}}`;
  }
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(configured);
  if (Buffer.byteLength(env.OPENCODE_CONFIG_CONTENT) > 120 * 1024) throw validation('OpenCode 原生配置超过环境变量预算', { code: 'invalid_configuration' });
  await materializeOpencodeConfig(env, context.managed, runDir);
  context.signal?.throwIfAborted();
  return {
    ...(spec.startupInventoryVersion === 1 ? { startupInventory: (sessionId: string | undefined) => readStartupInventory(inventoryFile, inventoryNonce, sessionId) } : {}),
    // 计量器只用最终环境定位原生存储（每轮拉起用的就是这一份 env）。
    usageMeter: ({ resumed, startedAt }) => createOpencodeUsageMeter({ resumed, startedAt, configuredModel: spec.launch.model ?? null, env }),
    plan: (input) => ({
      cmd: buildOpencodeArgv(
        {
          head,
          agentName: checked?.agent.name ?? OPENCODE_AGENT_NAME,
          ...(input.resumeSessionId === undefined ? {} : { resumeSessionId: input.resumeSessionId }),
          binaryVersion,
        },
        input.prompt,
      ),
      env,
      // prompt 走 argv 位置参数，stdin 一律 ignore（源同）。
      stdin: { mode: 'ignore' },
    }),
    parseEvent,
    detectSessionNotFound: detectOpencodeSessionNotFound,
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
