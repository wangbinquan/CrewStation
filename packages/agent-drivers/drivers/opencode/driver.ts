// ← agent-workflow `runtime/opencode/driver.ts` 的装配段（`assembleOpencodePersonaSpawn`）。
// 不复制的部分：清单插件物化、skill staging、工作区边界、SQLite 会话捕获、模型列举、
// `AGENT_WORKFLOW_OPENCODE_BIN` ／ `OPENCODE_PURE` 环境开关（依据见包根 index.ts）。
//
// 每次运行建出的目录：`<runDir>/.opencode/skills/` —— 即使零个 skill 也要建，
// 源记录过 opencode 1.17+ 在配置目录缺失时会直接 exit 1。

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDriver as AgentDriverName } from '@crewstation/contracts';
import type { CliAgentDriver, DriverAgentSpec, DriverLaunchContext } from '../../contract/agentDriver';
import type { AgentSpawnContext } from '../../contract/spawnPlan';
import { toMcpServerSpec } from '../../contract/spawnPlan';
import { pickRuntimeHead } from '../../injection/spawnHead';
import { createRunDirectory, defaultRunDir } from '../../process/runDirectory';
import type { CliAdapterOptions, CliRuntimeAdapter, PreparedRuntime } from '../cliRuntimeAdapter';
import { createCliAgentDriver } from '../cliAgentDriver';
import { OPENCODE_AGENT_NAME, buildOpencodeArgv } from './argv';
import { OPENCODE_CONFIG_DIR_NAME, OPENCODE_INLINE_CONFIG_WARN_BYTES, buildOpencodeEnv } from './env';
import { materializeOpencodeConfig } from './managedConfig';
import { parseEvent } from './events';
import { detectOpencodeSessionNotFound, ensureOpencodeBinaryVersion } from './probe';

export const OPENCODE_DRIVER_NAME: AgentDriverName = 'opencode';
export const OPENCODE_BINARY = 'opencode';

export function opencodeAdapter(options: CliAdapterOptions = {}): CliRuntimeAdapter {
  const head = pickRuntimeHead(options.binaryPath, [OPENCODE_BINARY]);
  return {
    name: OPENCODE_DRIVER_NAME,
    binary: head[0] ?? OPENCODE_BINARY,
    // `opencode run --help`（1.18.29 实测）的 message 是位置参数，没有任何 stdin 流入口：
    // 交互式只能退化为「一轮一进程 ＋ `--session <id>` 续接」。
    supportsResidentStream: false,
    prepare: (spec, context) => prepareOpencode(spec, context, head),
  };
}

export function createOpencodeDriver(which: (binary: string) => string | null, options: CliAdapterOptions = {}): CliAgentDriver {
  return createCliAgentDriver(opencodeAdapter(options), which);
}

async function prepareOpencode(spec: DriverAgentSpec, context: DriverLaunchContext, head: string[]): Promise<PreparedRuntime> {
  const runDir = await createRunDirectory(context.runDir ?? defaultRunDir(spec.agentId), context.host);
  const configDir = join(runDir.path, OPENCODE_CONFIG_DIR_NAME);
  mkdirSync(join(configDir, 'skills'), { recursive: true, mode: 0o700 });
  await context.host.chownToWorker(configDir);
  await context.host.chownToWorker(join(configDir, 'skills'));
  const base = { ...baseContext(spec, context, runDir.path), head };
  const { env, inlineConfigBytes } = buildOpencodeEnv(base, configDir);
  if (inlineConfigBytes > OPENCODE_INLINE_CONFIG_WARN_BYTES) {
    context.logger.warn('opencode 内联配置偏大', { bytes: inlineConfigBytes, limit: OPENCODE_INLINE_CONFIG_WARN_BYTES });
  }
  // RFC-004：管理员 opencode 配置为底、平台叠加层在上，合成为 OPENCODE_CONFIG 指向的单个文件。
  await materializeOpencodeConfig(env, context.managed, runDir);
  // auto-approve flag 的拼写在 1.18.0 改过，拼错会让每次拉起都只剩一整块 usage ＋ exit 1，所以先探版本。
  const binaryVersion = await ensureOpencodeBinaryVersion(context.host, head, { cwd: context.cwd, env: context.env, logger: context.logger });
  return {
    plan: (input) => ({
      cmd: buildOpencodeArgv(
        {
          head,
          agentName: OPENCODE_AGENT_NAME,
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
    ...(context.managed ? { managed: context.managed } : {}),
  };
}
