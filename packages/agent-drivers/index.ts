// 自 agent-workflow（commit 262d2658911fc319146f7c8cd74a1d3a23414d64）复制改造的
// Claude Code ／ OpenCode 驱动；逐文件对照表见 docs/engineering/agent-drivers-copy-manifest.md §11.2。
// 只供 runtimes/task 使用（tools/arch 的 RESTRICTED_PACKAGES 锁住）。
//
// ── 刻意不复制的部分 ───────────────────────────────────────────────────────────
//  1. 全部 Windows 分支：输出 spool、Job Object、预激活 launcher 的 Windows 形态。
//     CrewStation 只跑 Linux 容器。
//  2. 沙箱／工作区边界层（两个 CLI 的 `boundary.ts`、`workspaceBoundary`、`--settings`
//     里的 `sandbox.enabled`、opencode 的 `external_directory` 合成）。CrewStation 在任务
//     容器内**关闭** Claude Code 内置沙箱（已登记并接受的偏离），隔离由容器本身提供。
//  3. 清单插件面：`aw-inventory-dump.mjs`、转码器、`inventory.ts`、`selfCheck.ts`、
//     `drainFinalEvents`。它们只服务「声明注入了什么 vs 运行时实际加载了什么」的对账。
//  4. skill staging、worktree 投影（`stageSkills`、`stageClaudeWorktreeSkills/Agents`）
//     与会话捕获（两个 `sessionCapture.ts`、`sessionWalk`、`subagentLiveCapture`、
//     `distillSessionCapture`）。它们服务 agent-workflow 的 DAG 编排与知识蒸馏，
//     CrewStation 明确不做。
//  5. `runner.ts` 的 DAG 编排 —— 复制规则里就排除在外。
//  6. 预激活 launcher 的耐久 PID 收据：任务容器以 tini 为 PID 1，容器消亡即收割孤儿。
//
// ── 相对源的行为变更（都在对应文件的注释里再说明一次）─────────────────────────
//  - 子进程一律经宿主注入的 ProcessHost 拉起（setpriv 降权到 uid 10001），不再直接 Bun.spawn；
//    杀树与按行泵送也复用宿主的 processTree.ts ／ streamPump.ts。
//  - 交互式常驻流（`--input-format stream-json`）是源里没有的新路径，见 drivers/claudeCode/streamInput.ts。
//  - CrewStation 的三档权限（read-only／edit／full）→ opencode permission map 是新增的一层，
//    见 permission/opencodePermission.ts。
//  - 错误一律用 @crewstation/kernel 的 validation() 等助手，不再用 agent-workflow 的错误类型。

export type { DriverAgentProcess, DriverAgentSpec, DriverLaunchContext, CliAgentDriver } from './contract/agentDriver';
export { DriverStateError } from './contract/agentDriver';
export type {
  DriverChildProcess,
  DriverChildProcessWithStdin,
  DriverLaunchSpec,
  ProcessHost,
} from './contract/processHost';
export type {
  NormalizedEvent,
  NormalizedEventKind,
  NormalizedTokenDelta,
  NormalizedToolCall,
  SystemEventObservation,
} from './contract/normalizedEvent';
export type { AgentSpawnContext, McpServerSpec, SpawnPlan } from './contract/spawnPlan';
export { toMcpServerSpec } from './contract/spawnPlan';

export type { CliAdapterOptions, CliRuntimeAdapter, PreparedRuntime, TurnInput } from './drivers/cliRuntimeAdapter';
export { createCliAgentDriver } from './drivers/cliAgentDriver';
export { CLAUDE_BINARY, CLAUDE_DRIVER_NAME, claudeCodeAdapter, createClaudeCodeDriver } from './drivers/claudeCode/driver';
export { OPENCODE_BINARY, OPENCODE_DRIVER_NAME, createOpencodeDriver, opencodeAdapter } from './drivers/opencode/driver';

export {
  CLAUDE_HEADLESS_BASE_ARGV,
  CLAUDE_PLATFORM_OWNED_FLAGS,
  CLAUDE_STREAM_INPUT_ARGV,
  buildClaudeArgv,
  buildClaudeSpawn,
  claudeExplicitPermissionArgv,
  claudeModelName,
  renderClaudeMcpConfig,
} from './drivers/claudeCode/argv';
export { assembleClaudeEnv } from './drivers/claudeCode/env';
export { detectClaudeSessionNotFound, observeSystemEvent as observeClaudeSystemEvent, parseEvent as parseClaudeEvent } from './drivers/claudeCode/events';
export { claudeUserMessageFrame } from './drivers/claudeCode/streamInput';
export type { CliProbeResult, ProbeOptions } from './drivers/claudeCode/probe';
export { MIN_CLAUDE_CODE_VERSION, probeClaudeCode } from './drivers/claudeCode/probe';

export {
  MAX_OPENCODE_PROMPT_BYTES,
  OPENCODE_AGENT_NAME,
  OPENCODE_AUTO_FLAG_RENAME_VERSION,
  buildOpencodeArgv,
  resolveAutoApproveFlag,
} from './drivers/opencode/argv';
export { OPENCODE_CONFIG_DIR_ENV, OPENCODE_CONFIG_DIR_NAME, buildOpencodeEnv } from './drivers/opencode/env';
export { buildOpencodeInlineConfig, renderOpencodeAgentEntry } from './drivers/opencode/inlineConfig';
export { computeTokenDelta, extractTextFromEvent, inferEventKind, observeSystemEvent as observeOpencodeSystemEvent, parseEvent as parseOpencodeEvent } from './drivers/opencode/events';
export { detectOpencodeSessionNotFound, ensureOpencodeBinaryVersion, probeOpencode, resetOpencodeProbes } from './drivers/opencode/probe';
export { getOpencodeBinaryVersion, recordOpencodeBinaryVersion, resetOpencodeBinaryVersions } from './drivers/opencode/versionRegistry';

export type { ClaudeToolGate, GrantableClaudeTool } from './permission/claudeToolGate';
export { claudeToolGateFor, claudeToolsValue, mapAgentPermissionToClaudeTools } from './permission/claudeToolGate';
export type { OpencodePermissionAction, OpencodePermissionKey, OpencodePermissionMap } from './permission/opencodePermission';
export { OPENCODE_PERMISSION_ACTIONS, OPENCODE_PERMISSION_KEYS, OPENCODE_PERMISSION_WILDCARD_KEY, opencodePermissionFor } from './permission/opencodePermission';

export {
  partitionMcpsForInjection,
  renderClaudeMcpInjection,
  renderClaudeMcpServerEntry,
  renderOpencodeMcpEntry,
  renderOpencodeMcpInjection,
} from './injection/mcpInjection';

export { pickRuntimeHead } from './injection/spawnHead';
export { compareSemver, extractVersion } from './process/semver';
export { DEFAULT_VERSION_PROBE_TIMEOUT_MS, spawnVersionProbe } from './process/versionProbe';
export { MAX_STDERR_TAIL_CHARS, createBoundedTail } from './process/boundedTail';
export { RUN_DIR_PREFIX, createRunDirectory, defaultRunDir } from './process/runDirectory';
