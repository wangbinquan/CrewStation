# agent-drivers 复制清单｜自 agent-workflow 复制的驱动代码对照表

> 状态：只读分析结果（2026-09-11），供 Plan T0.2「登记源 commit 与逐文件对照表」使用；本文不改动 agent-workflow，也不改动 CrewStation 代码  
> 版本：0.1 · 日期：2026-09-11  
> 范围：CLAUDE.md「Code reuse」定义的复制单元 —— `packages/backend/src/services/runtime/` 下的 `RuntimeDriver` 驱动（OpenCode／Claude Code）、`execution/agentInjection*`、`agentProcess*`、`managedProcess*`，以及 `packages/shared` 的 Agent／Mcp／AgentPermission schema。`runner.ts` 的 DAG 编排不在范围内  
> 约束：复制后每个文件 ≤ 600 行，不得使用 `utils.ts`／`helpers.ts` 等禁用文件名，`packages/agent-drivers` 只能依赖 `@crewstation/kernel`、`@crewstation/contracts` 与 npm 包（见 `docs/engineering/repository-structure.md` §4、§9）

## 目录

- [0. 结论摘要](#0-结论摘要)
- [1. 源 commit](#1-源-commit)
- [2. 复制单元清单](#2-复制单元清单)
- [3. 两个 CLI 的拉起方式](#3-两个-cli-的拉起方式)
- [4. 流式输出解析](#4-流式输出解析)
- [5. 会话恢复](#5-会话恢复)
- [6. MCP 注入](#6-mcp-注入)
- [7. 权限映射](#7-权限映射)
- [8. 沙箱相关](#8-沙箱相关)
- [9. HOME／XDG／配置目录](#9-homexdg配置目录)
- [10. 交互式流（Q22）](#10-交互式流q22)
- [11. 目标布局、文件对照与依赖反转](#11-目标布局文件对照与依赖反转)
- [12. 风险与未知](#12-风险与未知)

## 0. 结论摘要

- 复制单元共 **40 个文件、10128 行**（`runtime/` 34 个文件 7157 行；`execution/` 4 个文件 2214 行；`shared/src/schemas/agent.ts`＋`mcp.ts` 757 行）。其中 4 个文件超过 600 行（`types.ts` 971、`managedProcess.ts` 989、`claudeCode/driver.ts` 607、`managedProcessLauncher.ts` 601），1 个文件使用禁用名（`opencode/util.ts`），2 个非根 `index.ts`（`runtime/index.ts`，以及 `opencode/plugin/index.ts` 且含 `export *` 桶）。
- `AgentPermission` 不是独立文件：`AgentPermissionSchema = z.record(z.string(), z.unknown())` 定义在 `shared/src/schemas/agent.ts:217`，语义是 **opencode 的 permission map 原样透传**。`shared/src/schemas/permission.ts`（1318 行）是平台 RBAC（admin／user／manager／guest），与 agent 权限无关，**不复制**。
- 两个 CLI 都是 **一轮一进程** 的 one-shot 调用：Claude 用 `-p --output-format stream-json --verbose`，prompt 经 stdin 一次写入后关闭；OpenCode 用 `run --agent <name> --format json --thinking --auto -- <prompt>`，prompt 作为 argv 尾随位置参数。代码中不存在任何向存活 CLI 进程持续写 stdin 的路径（Q22 见 §10）。
- 进程可靠性层（`managedProcess.ts`）使用 POSIX 分离进程组 + `SIGTERM → 宽限 → SIGKILL → 5 s 收割期限` 的杀树链；Windows 分支（输出 spool、Job Object、预激活 launcher 的 Windows 形态）在 CrewStation（Linux 容器）中可整体删除。
- 需要反转或重写的单元外依赖共 20 项（§11.3），主要是日志、路径安全、进程树、git 元数据目录、会话持久化端口、SQLite 只读端口、embed 表、`@agent-workflow/shared` 的 schema 子集。

## 1. 源 commit

| 项 | 值 |
|---|---|
| 仓库 | `/Users/wangbinquan/dev/proj/agent-workflow`，分支 `main` |
| `git rev-parse HEAD` | `262d2658911fc319146f7c8cd74a1d3a23414d64` |
| `git log -1 --format='%H %ci %s'` | `262d2658911fc319146f7c8cd74a1d3a23414d64 2026-09-11 17:46:22 +0800 test(rfc-359): 资源包导入的双引擎对拍补上 workflow / mcp 两个 kind（分叉是逐 kind 一条臂）` |
| 工作树状态 | 两个已修改文件均在复制单元之外（`packages/backend/tests/rfc359-w12-resource-package-commit-provider.test.ts`、`packages/system-mocks/src/cli.ts`）；复制单元内文件与 HEAD 一致 |
| 工具链声明 | 根 `package.json`：`"bun": ">=1.4.0"`、`"packageManager": "bun@1.4.0"`、`typescript ^5.7.0`、`zod ^3.23.8`、`yaml ^2.6.1`、`hono 4.12.26`、`drizzle-orm ^0.45.2` |
| 本机观测 | `bun --version` 输出 `1.3.13`（低于 agent-workflow 声明的 1.4.0；CrewStation 根 `package.json` 声明 `bun >=1.3.0`、`@types/bun 1.4.2`） |

## 2. 复制单元清单

「单元外内部 import」列只列指向复制单元**之外**的 agent-workflow 内部模块（`@/…` 与 `@agent-workflow/shared`），这些都必须反转或重写；单元内相互 import（`../types`、`./events` 等）不列。「npm／运行时」列只列 npm 包与 Bun 专有 API，Node 内置模块（`node:fs`、`node:path`、`node:os`、`node:crypto`、`node:url`、`node:fs/promises`）不逐一列出。

### 2.1 `packages/backend/src/services/runtime/`（34 个文件，7157 行）

| 路径（相对 `services/runtime/`） | 行数 | 用途 | 单元外内部 import | npm／运行时 |
|---|---:|---|---|---|
| `types.ts` | 971 | 整个驱动契约：`RuntimeDriver`、`NormalizedEvent`、`SpawnPlan`、`AgentSpawnContext`、两个 @deprecated 的旧上下文、探针／模型／会话捕获上下文 | `@/util/log`（`Logger` 类型）、`@/modules/task-execution/application/ports/runtimeSessionCapturePersistence`（类型）、`@/services/runtimeRegistry`（`RuntimeProfile` 类型）、`@agent-workflow/shared`（`Agent`、`Mcp`、`FaceSupport`、`InventoryDeclaration`、`InventorySnapshot`、`RuntimeConfigDirProfile`、`RuntimeInventoryPayload` 类型） | — |
| `index.ts` | 84 | 驱动注册表 `getRuntimeDriver`／`tryGetRuntimeDriver`／`RUNTIME_KINDS`／`isKnownRuntimeKind`，另有 6 个具名再导出（非桶） | — | — |
| `head.ts` | 20 | `pickRuntimeHead(runtimeBinary, fallback)`：自定义二进制优先于测试用命令头 | — | — |
| `spawnCtx.ts` | 107 | `AgentSpawnContext` → 旧 `SystemAgentSpawnContext`／`BusinessNodeSpawnContext` 的翻译层（`toSystemCtx`、`toBusinessCtx`、`syntheticPersonaAgent`） | `@agent-workflow/shared`（`Agent` 类型） | — |
| `stageSkills.ts` | 98 | 把 managed skill 目录 `cpSync` 到 `<configDir>/skills/<name>`，排除 `.claude-plugin` 条目 | `@/util/log`（`Logger` 类型） | — |
| `injectionIdentity.ts` | 71 | 同名异 id 的 agent／skill／mcp 冲突检测（纯函数） | — | — |
| `selfCheck.ts` | 123 | 启动自检：每个驱动对每个声明面表态、`init-event` 驱动的 `parseEvent` 能产出清单 | `@/services/execution/resourcePolicy`（`DISABLED_RESOURCE_POLICY`、`notModeledDisabledKinds`、`DisableableResourceKind`） | — |
| `claudeCode/driver.ts` | 607 | `claudeCodeDriver` 对象；`renderClaudeInjection`、`assembleClaudePersonaSpawn`、`assembleClaudeBusinessSpawn`、`writeClaudeMcpConfig`（0o700 目录、0o600 文件） | `@agent-workflow/shared`（`DEFAULT_CONFIG_DIR_PROFILE`）、`@/util/git`（`gitMetaDirsFor`）、`@/services/execution/workspaceBoundary`（`scanSiblingTaskRoots`、`toolchainCacheDirs`） | `Bun.which` |
| `claudeCode/spawn.ts` | 306 | argv 与 env 装配：`CLAUDE_HEADLESS_BASE_ARGV`、`CLAUDE_PLATFORM_OWNED_FLAGS`、`claudeExplicitPermissionArgv`、`buildClaudeSpawn`、`assembleClaudeEnv` | — | — |
| `claudeCode/events.ts` | 277 | stream-json 行 → `NormalizedEvent`；`observeSystemEvent`、`inventoryFacesFromInitEvent`、`parseResultError` | `@agent-workflow/shared`（`ObservedInventoryFaces`、`ObservedInventoryItem` 类型） | — |
| `claudeCode/permissionMap.ts` | 190 | opencode permission map → Claude `--tools` 载入集（`mapAgentPermissionToClaudeTools`、`claudeBusinessGate`、`claudeToolsValue`） | `@agent-workflow/shared`（`OPENCODE_PERMISSION_ACTIONS`、`AgentPermission`） | — |
| `claudeCode/inject.ts` | 33 | `toClaudeAgents`：把 `renderClaudeSubagentEntries` 与生产 gate 绑定的适配器 | `@agent-workflow/shared`（`Agent` 类型） | — |
| `claudeCode/boundary.ts` | 265 | Claude 侧写边界：`renderClaudeBoundary`（`settings.json` 形状）、`claudeWriteBoundaryAvailability`、`claudeExpressibleAuthorDirs`、`isClaudeRuleExpressible` | `@agent-workflow/shared`（`AgentPermission` 类型）、`@/util/platformExec`（`isLexicallyInsideForHost`） | — |
| `claudeCode/config.ts` | 467 | managed skill 附件文本 `renderClaudeManagedSkillAttachments`；worktree 投影 `stageClaudeWorktreeSkills`／`stageClaudeWorktreeAgents`（含 dev/ino 身份校验的清理） | `@/util/log`（类型）、`@/util/fileTrust`（`assertSameDirectoryIdentityForHost`、`assertSameFileIdentityForHost`）、`@/util/safePath`（`assertWriteAncestorInside`、`safeJoin`） | `yaml`（`stringify`） |
| `claudeCode/sessionCapture.ts` | 366 | 运行后读取 Claude 子代理 JSONL 转录（`claudeUserConfigRoots`、`cwdSlug`、`captureClaudeSessions`） | `@agent-workflow/shared`（`DEFAULT_CONFIG_DIR_PROFILE`、`maskDiagnosticsText`、`RuntimeConfigDirProfile`）、`@/modules/task-execution/.../runtimeSessionCapturePersistence`（类型）、`@/util/log`（类型） | — |
| `claudeCode/probe.ts` | 80 | `probeClaudeCode`：`<binary> --version` 探针，`MIN_CLAUDE_CODE_VERSION = '2.0.0'` | `@/util/log`（`createLogger`）、`@/util/semver`（`extractVersion`）、`@/util/process`（`spawnVersionProbe`、`DEFAULT_VERSION_PROBE_TIMEOUT_MS`） | — |
| `claudeCode/models.ts` | 26 | 静态模型表（`opus`／`sonnet`／`haiku`／`fable` 别名与 4 个完整 id） | — | — |
| `opencode/driver.ts` | 489 | `opencodeDriver` 对象；`renderOpencodeInjection`、`assembleOpencodePersonaSpawn`、`assembleOpencodeBusinessSpawn`；可选能力 `readInventory`、`drainFinalEvents`、`startLiveCapture`、`captureSessionsToSink`、`captureDistillSession` | `@agent-workflow/shared`（`InventorySnapshot`、`inventoryFacesFromSnapshot`、`isAgentNodeKind`）、`@/services/execution/workspaceBoundary`（`BoundaryCtx` 类型）、`@/util/git`（`gitMetaDirsFor`） | 读 `process.env.AGENT_WORKFLOW_OPENCODE_BIN`、`OPENCODE_PURE` |
| `opencode/spawn.ts` | 254 | `buildCommand`（argv）、`resolveAutoApproveFlag`、`MAX_OPENCODE_PROMPT_BYTES`、`buildOpencodeEnv`、`buildOpencodeSpawn` | `@agent-workflow/shared`（`DEFAULT_CONFIG_DIR_PROFILE`、`envNameMatches`）、`@/util/semver`（`compareSemver`、`extractVersion`） | — |
| `opencode/events.ts` | 194 | `--format json` 行 → `NormalizedEvent`；`extractTextFromEvent`、`inferEventKind`、`accumulateTokens`、`computeTokenDelta`、`observeSystemEvent` | — | — |
| `opencode/inlineConfig.ts` | 116 | `buildInlineConfig`：`OPENCODE_CONFIG_CONTENT` 的 agent 表＋mcp 表＋plugin 数组＋顶层 `permission` | `@agent-workflow/shared`（`Agent`、`Mcp` 类型）、`@/services/runtimeRegistry`（`RuntimeProfile` 类型）、`@/services/execution/workspaceBoundary`（`BoundaryCtx` 类型） | — |
| `opencode/boundary.ts` | 153 | `opencodeDataDir`、`machineSkillRoots`、`composeOpencodeBoundary`（`external_directory` 合成） | `@agent-workflow/shared`（`OPENCODE_PERMISSION_KEYS`、`AgentPermission`）、`@/services/execution/workspaceBoundary`（`BoundaryCtx`、`ExternalDirRule` 类型） | 读 `XDG_DATA_HOME`、`XDG_CONFIG_HOME` |
| `opencode/pluginSpec.ts` | 68 | 插件选择 → `config.plugin` 数组（`buildPluginSpecArray`、`selectShippedPlugins`、`pluginFileSpec`） | — | — |
| `opencode/plugin/index.ts` | 78 | `materializeInventoryPlugin(runRoot)`：把 `.mjs` 复制到运行目录（dev 树或 embed 表）；`export * from './transcoder'` | `../../../../embed.generated`（`PLUGIN_FILES`） | `Bun.file` |
| `opencode/plugin/transcoder.ts` | 96 | opencode SDK 形状 → `InventoryAgent`／`InventorySkill`／`InventoryMcp`／`InventoryPlugin` | `@agent-workflow/shared`（4 个 Inventory 类型） | — |
| `opencode/plugin/aw-inventory-dump.mjs` | 202 | 在 opencode **子进程内**运行的插件：`server` 钩子调 SDK 拿 agents／skills／mcp 状态，写 `$OPENCODE_AW_INVENTORY_OUT` | —（零 import） | `Bun.write` |
| `opencode/inventory.ts` | 130 | `readSnapshotFromRunDir`：读 `<runDir>/inventory.json` 并 zod 校验；`runRootFor`（REST 辅助） | `@agent-workflow/shared`（`isAgentNodeKind`、`inventoryReasonCode`、`InventorySnapshotCapturedSchema`、`InventorySnapshotMissingSchema`、`normalizeInventoryRaw`、类型）、`@/util/paths`（`Paths.runsDir`） | — |
| `opencode/models.ts` | 170 | `opencode models --verbose` 解析与按二进制缓存（`listOpencodeModels`、`parseModelsOutput`、`listOpencodeModelsNatural`、`evictOpencodeModelsCache`） | `@agent-workflow/shared`（`OpencodeModel` 类型）、`@/util/log`、`@/util/process`（`spawnVersionProbe`） | — |
| `opencode/util.ts` | 115 | `probeOpencode`（`--version` 探针并登记版本）、`detectOpencodeSessionNotFound`；再导出 semver 与 `ProbeOpts` | `@/util/log`、`@/util/semver`、`@/util/process` | — |
| `opencode/versionRegistry.ts` | 45 | 进程内 `Map<binary, version>`，供 `--auto` 拼写选择 | — | — |
| `opencode/sessionCapture.ts` | 442 | 运行后从 opencode SQLite BFS 子会话并转码为事件（`resolveOpencodeDbPath`、`transcodeOpencodeRowsToEvents`、`captureChildSessions`、`captureOpencodeSessionsToSink`、`loadSiblingsCapturedSessionIds`） | `@agent-workflow/shared`（`maskDiagnosticsText`）、`@/modules/task-execution/.../runtimeSessionCapturePersistence`（类型）、`@/util/log`、`@/services/sessionEventSink`（`SystemAgentEventSinkV1` 类型）、`@/platform/persistence/sqlite/readonlySqliteDatabase` | 读 `OPENCODE_TEST_HOME`、`XDG_DATA_HOME`；（经依赖）`bun:sqlite` |
| `opencode/sessionWalk.ts` | 130 | `walkOpencodeSessions`：`session.parent_id` BFS 与 `message`／`part` 行读取（三条 SQL） | `@/platform/persistence/sqlite/readonlySqliteDatabase`（类型） | — |
| `opencode/subagentLiveCapture.ts` | 307 | 运行中按 `pollMs` 轮询 SQLite 的子会话增量捕获（partId 去重、连续失败自禁用） | `@/modules/task-execution/.../runtimeSessionCapturePersistence`（类型）、`@/util/log`、`@/platform/persistence/sqlite/readonlySqliteDatabase` | — |
| `opencode/distillSessionCapture.ts` | 77 | 记忆蒸馏任务的会话捕获（`captureDistillJobSession`） | `@/platform/persistence/sqlite/readonlySqliteDatabase`、`@/util/log` | — |

### 2.2 `packages/backend/src/services/execution/`（4 个文件，2214 行）

| 路径（相对 `services/execution/`） | 行数 | 用途 | 单元外内部 import | npm／运行时 |
|---|---:|---|---|---|
| `agentInjection.ts` | 403 | 注入装配 A 层：MCP 分拣与两种 wire 形状、`renderOpencodeAgentEntry`、`renderClaudeSubagentEntries`、声明清单辅助（`declareSkills`／`declareSubagents`／`declarePlugins`、`weaveMemoryBlock`、`deriveClaudeDroppedParams`）、`RuntimePlugin` 类型、`EMPTY_RUNTIME_PROFILE` | `@agent-workflow/shared`（`Agent`、`DeclaredInjectionManifest`、`Mcp`、`Plugin` 类型）、`@/services/runtimeRegistry`（`RuntimeProfile` 类型） | — |
| `agentProcess.ts` | 221 | `runAgentProcess`：`managedProcess` 的 agent 适配（收据 fence、outcome 映射、reap 后 cleanup） | `@/util/log`（类型） | — |
| `managedProcess.ts` | 989 | `runManagedProcess`：流泵、行上限、PID 收据、超时／取消、杀树升级、排水期限；Windows 输出 spool | `@/util/log`（类型）、`@/util/process`（`adoptSpawnedProcessTree`、`awaitProcessTreeQuiesced`、`killProcessTree`、`releaseProcessTreeOwnership`）、`@/util/spawnDiagnostics`（`explainSpawnEnoent`）、`@/util/platformExec`（`platformSpawnOptionsForHost`）、`@agent-workflow/shared`（`JS_TIMER_MAX_MS`） | `Bun.spawn`、`Bun.Subprocess`、`Bun.sleep` |
| `managedProcessLauncher.ts` | 601 | 预激活 launcher：父进程先拿到 PID 收据、再经 stdin 发激活帧，launcher 才 `exec` 真正的 CLI；含 Windows 文件 spool 中继 | `@/embed.generated`（`MANAGED_PROCESS_LAUNCHER_SOURCE`）、`@/util/platformExec` | `Bun.spawn`、`Bun.stdin`、`Bun.argv` |

### 2.3 `packages/shared/src/schemas/`（2 个文件，757 行）

| 路径 | 行数 | 用途 | 单元外内部 import | npm |
|---|---:|---|---|---|
| `agent.ts` | 483 | `AgentSchema`（含 `AgentPermissionSchema`、`OPENCODE_PERMISSION_ACTIONS`／`KEYS`／`WILDCARD_KEY`、skill ref、输入输出端口、Create／Update／Rename／Delete 请求体） | `./resourceAcl`（`ResourceVisibilitySchema`）、`./importRef`（`ImportRefSelectionSchema`）、`./review`（`AgentOutputKindSchema`） | `zod` |
| `mcp.ts` | 274 | `McpLocalConfigSchema`、`McpRemoteConfigSchema`、`McpSchema`（`local`／`remote` 判别联合）、env 名校验、Create／Update 请求体 | `./operationRevision`（`OperationConfigHashSchema`）、`./resourceAcl` | `zod` |

驱动代码从 `Agent` 上实际读取的字段只有 `name`、`description`、`bodyMd`、`permission`、`outputs`（`renderOpencodeAgentEntry` 写进 `options.outputs`）；从 `Mcp` 上读取 `id`、`name`、`type`、`enabled`、`config.command`／`env`／`timeoutMs`／`url`／`headers`／`oauth`。其余字段（ACL、输入输出端口、角色、导入引用、乐观锁）都是 agent-workflow 的资源管理面，可在复制时裁掉。

### 2.4 合计与违规统计

| 项 | 值 |
|---|---|
| 文件数 | 40（`runtime/` 34 ＋ `execution/` 4 ＋ `shared/schemas/` 2） |
| 行数 | 10128（7157 ＋ 2214 ＋ 757） |
| 超过 600 行 | `types.ts`（971）、`managedProcess.ts`（989）、`claudeCode/driver.ts`（607）、`managedProcessLauncher.ts`（601） |
| 禁用文件名 | `opencode/util.ts`；非根 `index.ts`：`runtime/index.ts`、`opencode/plugin/index.ts`（后者含 `export *` 桶） |
| 单目录文件数 | `opencode/` 直接包含 14 个源码文件（另有 `plugin/` 子目录 3 个；≤ 20，合规）；`claudeCode/` 10 个；`runtime/` 根 8 个 |
| npm 包 | `zod`（schema；agent-workflow 为 ^3.23.8，CrewStation `contracts` 锁定 4.6.2）、`yaml`（Claude 项目 agent 文件的 frontmatter） |
| Bun 专有 API（出现次数） | `Bun.spawn` 5、`Bun.Subprocess` 3、`Bun.sleep` 7、`Bun.write` 3（插件内）、`Bun.file` 2、`Bun.which` 2、`Bun.argv` 2、`Bun.stdin` 1（后两者仅 launcher）；`bun:sqlite` 经 `readonlySqliteDatabase` 依赖进入 |
| 引用本单元的测试文件 | 125 个（`packages/backend/tests` 与 `src` 下 `*.test.ts`，含间接引用） |

## 3. 两个 CLI 的拉起方式

### 3.1 Claude Code

**二进制名**：默认 `['claude']`；`defaultBinary(config)` 在 `config.claudeCodePath` 非空时返回 `[claudeCodePath]`；自定义 fork 通过 `runtimeBinary` 经 `pickRuntimeHead(runtimeBinary, runtimeCmd)` 覆盖；`runtimeCmd`／`binaryOverride` 仅测试使用（`[bun, run, mock]`）。

**argv 构造**（`claudeCode/spawn.ts:161-269` `buildClaudeSpawn`，按顺序）：

1. 命令头（`ctx.claudeCmd ?? ['claude']`）。
2. `CLAUDE_HEADLESS_BASE_ARGV` = `['-p', '--output-format', 'stream-json', '--verbose']`。
3. 权限段（二选一）：
   - 作者声明了非空 `agent.permission` → `claudeExplicitPermissionArgv`：`['--permission-mode', 'dontAsk', '--tools', <tools>]`，其中 `<tools>` 是 §7 映射出的逗号表；若同时传了 `--agents`，`Task` 会被追加进 `<tools>`；若有 MCP，再追加 `['--allowedTools', 'mcp__<name>__*,mcp__<name2>__*']`。
   - 未声明 → `['--permission-mode', 'bypassPermissions']`。
4. `['--model', <model>]`（模型来自根 agent 的 `RuntimeProfile.model`，为空则省略）。
5. `['--settings', '<runRoot>/settings.json']`（仅当 `boundary.taskMounts` 非空；见 §8）。
6. `['--append-system-prompt-file', '<runRoot>/system.md']`（恒有；文件内容 = agent `bodyMd` ＋ 可选记忆块 ＋ 可选 `<aw-managed-skills>` 附件文本）。
7. `['--mcp-config', '<runRoot>/mcp-config.json']`（有启用的 MCP 时；见 §6）。
8. `['--agents', <JSON 字符串>]`（有 dependsOn 闭包时，内联 JSON 直接放 argv）。
9. `['--resume', <resumeSessionId>]`（恢复时）。
10. `extraArgs`（注册表校验过的 fork 私有 flag），但会在此再过滤一次：命中 `CLAUDE_PLATFORM_OWNED_FLAGS` 的 token 连同其值被丢弃并回调 `onExtraArgsDropped`。平台独占 flag 集合：`-p`、`--print`、`--output-format`、`--input-format`、`--verbose`、`--model`、`--append-system-prompt-file`、`--append-system-prompt`、`--system-prompt`、`--system-prompt-file`、`--mcp-config`、`--agents`、`--resume`、`--continue`、`--session-id`、`--fork-session`、`--permission-mode`、`--dangerously-skip-permissions`、`--tools`、`--allowedTools`、`--allowed-tools`、`--disallowedTools`、`--disallowed-tools`、`--settings`、`--add-dir`。
11. 仅 persona 路径（`assembleClaudePersonaSpawn`，`driver.ts:120-122`）：`nativeSessionId` 非空时在最后追加 `['--session-id', <uuid>]`；与 `resumeSessionId` 同时出现则抛 `system-agent-native-session-conflict`。

**环境变量**（`assembleClaudeEnv`，`spawn.ts:284-306`）：从完整 `process.env` 复制，**剔除**任何大小写折叠后等于 `IS_SANDBOX` 的键；**设置** `PWD=<worktreePath>`；`RuntimeProfile.isSandbox === true` 时设置 `IS_SANDBOX=1`；`gitUserName` 与 `gitUserEmail` 同时非空时设置 `GIT_AUTHOR_NAME`、`GIT_AUTHOR_EMAIL`、`GIT_COMMITTER_NAME`、`GIT_COMMITTER_EMAIL`。**不设置** `CLAUDE_CONFIG_DIR`（RFC-276 起子进程沿用操作者自己的配置根）。

**cwd**：`worktreePath`（业务路径 = 任务工作树；persona 路径 = 一次性 scratch 目录；`runner.ts:1718` `cwd: opts.worktreePath`，`systemAgentRun.ts:482` `cwd: worktreeDir`）。

**stdin**：`{ mode: 'pipe', data: prompt }` —— `managedProcess.ts:596-607` 一次 `sink.write(data)` 后立即 `sink.end()`。

**每次运行写出的文件**：`<runRoot>/system.md`；`<runRoot>/settings.json`（可选）；`<runRoot>/mcp-config.json`（目录 `mkdirSync(..., { mode: 0o700 })`、文件 `{ mode: 0o600 }`）；`<runRoot>/claude-managed-skill-attachments/skills/<name>/`；投影 `<worktree>/<configDir.name>/skills/<name>/` 与 `<worktree>/<configDir.name>/agents/<name>.md`（`configDir.name` 默认 `.claude`；`flag: 'wx'` 拒绝覆盖已有文件；spawn 结束后按 dev/ino 身份校验逐个删除）。

### 3.2 OpenCode

**二进制名**：默认 `['opencode']`；`defaultBinary(config)` 在 `config.opencodePath` 非空时返回 `[opencodePath]`；persona 路径额外回退到环境变量 `AGENT_WORKFLOW_OPENCODE_BIN`（`driver.ts:83-91`）；自定义 fork 经 `runtimeBinary`。

**argv 构造**（`opencode/spawn.ts:79-134` `buildCommand`）：

```
[...head, 'run', '--agent', <agentName>, '--format', 'json', '--thinking', <autoFlag>, ('--session', <resumeSessionId>)?, '--', <prompt>]
```

- `<autoFlag>`：`resolveAutoApproveFlag(binaryVersion)` —— 已探测版本 ≥ `1.18.0` 或版本未知／不可解析 → `'--auto'`；明确低于 1.18.0 → `'--dangerously-skip-permissions'`（`OPENCODE_AUTO_FLAG_RENAME_VERSION = '1.18.0'`）。该 flag 无条件出现（CLI 无权限应答通道）。
- prompt 是 `--` 之后的尾随位置参数；`Buffer.byteLength(prompt) > 120 * 1024`（`MAX_OPENCODE_PROMPT_BYTES`）时抛 `prompt-too-large`（Linux 单 argv 元素上限 128 KiB）。

**环境变量**（`buildOpencodeEnv`，`spawn.ts:162-227`）：`{ ...process.env, PWD: <worktreePath>, [configDirEnv]: <runDir>, OPENCODE_CONFIG_CONTENT: <内联配置 JSON 字符串> }`；`configDirEnv` 默认 `OPENCODE_CONFIG_DIR`，等于 `'OPENCODE_PERMISSION'` 时抛 `runtime-config-dir-env-reserved`；**剔除** `OPENCODE_PERMISSION`（自定义 `configDirEnv` 时还剔除默认的 `OPENCODE_CONFIG_DIR`）；注入了清单插件时设置 `OPENCODE_AW_INVENTORY_OUT=<runRoot>/inventory.json`；git 身份四变量同 Claude。

**cwd**：`worktreePath`。**stdin**：`{ mode: 'ignore' }`。

**每次运行写出的文件**：`<runRoot>/<configDir.name>/skills/<name>/`（`configDir.name` 默认 `.opencode`；即使零个 skill 也创建 `skills/` 目录，因为 opencode 1.17+ 在配置目录缺失时退出 1）；`<runRoot>/aw-inventory-dump.mjs`；`<runRoot>/inventory.json`（由插件写）。

### 3.3 进程管理（`managedProcess.ts`／`agentProcess.ts`）

- **spawn**：`Bun.spawn({ cmd, cwd, env, stdout: 'pipe', stderr: 'pipe', stdin: 'pipe' | 'ignore', detached: process.platform !== 'win32' })`（`managedProcess.ts:485-503`）。POSIX 下 `detached: true` 让子进程成为进程组组长，`kill(-pid)` 可达整棵树。
- **预激活 launcher**（`requireSpawnReceipt: true` 时，runner 业务路径恒开启）：实际 spawn 的是 `[process.execPath, 'run', <managedProcessLauncher.ts 路径>, '__managed-process-launcher', '--launch-nonce', <uuid>, '--', ...targetArgv]`，env 追加 `AW_MANAGED_PROCESS_LAUNCH_NONCE=<uuid>`；父进程等 `onSpawned`（落库 PID 收据）返回后，向 launcher 的 stdin 写一帧 JSON `{ v: 1, launchNonce, targetArgv, targetEnv, stdin: {mode, data?} }` 并关闭；launcher 再以 `stdout/stderr: 'inherit'`、`detached: false`（留在同一进程组）spawn 真正的 CLI，把 CLI 的 stdin 写入并关闭，然后向 stderr 写控制记录 `AW_MANAGED_PROCESS_LAUNCH_READY:<nonce>`；父进程收到 READY 才开始计业务超时。launcher 退出码：125（未激活／帧无效）、126（中继失败）、127（目标 spawn 失败）。父进程死亡 → launcher 读到 stdin EOF → 不 spawn 目标即退出。
- **杀进程**（`escalate()`，`managedProcess.ts:774-795`）：`killProcessTree(pid, 'SIGTERM')` = `process.kill(-pid, 'SIGTERM')`，失败回退 `process.kill(pid, 'SIGTERM')`（`util/process.ts:71-86`）；再失败回退 `child.kill(15)`。经 `killEscalationGraceMs`（默认 `10_000`；runner `KILL_ESCALATION_GRACE_MS = 10_000`；`systemAgentRun`／`runtimeSmoke` 的 `CHILD_TERM_GRACE_MS = 2_000`）后 `SIGKILL` 整组；再经 `FINAL_REAP_MARGIN_MS = 5_000` 仍未退出 → 结果 `child-unkillable`，`child.unref()` 放弃等待。杀过树的运行在收尾前 `awaitProcessTreeQuiesced(pid)`（预算 `TREE_QUIESCE_BUDGET_MS = 2_000`，每 25 ms `kill(-pid, 0)` 探测）。
- **超时**：`timeoutMs` 可选（未传 = 无墙钟超时），必须是 `0 … JS_TIMER_MAX_MS (2_147_483_647)` 的整数；到期 → outcome `timeout` ＋ `escalate()`。调用方默认值：runner 透传节点配置（可为 undefined），`systemAgentRun` `DEFAULT_TIMEOUT_MS = 600_000`，`runtimeSmoke` `60_000`。
- **取消**：`AbortSignal` → outcome `aborted` ＋ `escalate()`；`agentProcess` 把外部 signal 与「PID 收据落库失败」合并成一个 controller（收据失败 → `aborted`）。
- **排水**：子进程退出后等两条流 EOF 最多 `max(1_000, graceMs)` ms；超时 → `SIGKILL` 整组；agent 路径（`keepExitedOnDrainTimeout: true`）保留真实 `exitCode` 并置 `drainTimedOut: true`。
- **流上限**：单行 `MANAGED_PROCESS_MAX_LINE_CHARS = 1 MiB`（超出截断并附 `…[line truncated]`，回调 `onLineTruncated`）；stderr 滚动尾部与可选 raw stdout `MANAGED_PROCESS_MAX_STREAM_CHARS = 8 MiB`。
- **结果**：`ManagedProcessOutcome = 'exited' | 'timeout' | 'aborted' | 'spawn-failed' | 'child-unkillable'` → `AgentProcessOutcome = 'ok' | 'nonzero-exit' | 'timeout' | 'aborted' | 'spawn-failed' | 'unreaped'`；`cleanup` 只在非 `unreaped` 时执行。`Bun.spawn` 抛 ENOENT 时经 `explainSpawnEnoent` 区分「cwd 不存在」与「可执行文件不存在」。
- **版本探针**（`spawnVersionProbe`，`util/process.ts:586-629`）：`Bun.spawn([...head, '--version'], { detached: true })`，`timeoutMs` 必填（默认常量 `DEFAULT_VERSION_PROBE_TIMEOUT_MS = 10_000`），到期 `killProcessTree(pid, 'SIGKILL')`；finally 中 `reapDetachedGroup` 只对负 PGID 发 `SIGKILL`，不回退正 PID。`opencode models --verbose` 走同一骨架的 `maxBytes` 形态（4 MiB／流、30 s 超时、250 ms 组死等待）。

## 4. 流式输出解析

### 4.1 Claude Code（`claudeCode/events.ts`）

- **输出格式**：`--output-format stream-json`（每行一个 JSON 对象）。**未**使用 `--include-partial-messages`，因此没有 token 级文本增量；2.1.202 起 assistant 事件按内容块逐条到达（同一 `message.id` 重复）。
- **识别的 `type`**：`system`（`subtype` 见过 `init`、`status`、`thinking_tokens`、`task_started`、`task_notification`、`hook_*`）、`assistant`、`user`、`result`、`conversation_reset`、`stream_event`、`tool_progress`。非 JSON 或非对象行 → `parseEvent` 返回 `null`，由调用方泵走「原样文本」路径。
- **根会话判定**：`parent_tool_use_id` 非空、`isSidechain === true` 或 `subagent_type` 为字符串 → 子代理侧链帧，不贡献 `sessionId`；`type ∈ {assistant, user, stream_event, tool_progress}` 且 `parent_tool_use_id === null`、或 `type ∈ {result, conversation_reset}`、或 `system/init` → 根帧，取其 `session_id`。
- **kind**：`result` → `step_finish`；`system` → `step_start`；`user` → `tool_use`（tool_result 回合）；`assistant` → 内容块含 `tool_use` → `tool_use`，否则含 `thinking` → `reasoning`，否则 `text`。
- **文本**：`message.content[]` 中 `type === 'text'` 的 `text` 串联；无则 `null`。
- **工具调用**：只判定 kind，不展开参数；原始行经 `rawLine` 原样落库，树形渲染在别处再解析。
- **权限提示**：Claude 侧**没有**任何映射到 `permission_asked` 的分支（headless 下 `dontAsk`／`bypassPermissions` 不会出提示）。
- **完成**：`result` 事件；`observeSystemEvent` 把 `type === 'result'` 判为 `terminalResult: is_error === true ? 'error' : 'success'`；`parseResultError` 返回 `{ isError: evt.is_error === true, message: evt.result（字符串） }`，驱动的 `parseTerminalResultError` 只在 `isError` 时返回文案（空文案回退 `'claude reported a terminal error result'`）。
- **错误**：非零退出由调用方判；干净退出但 `result.is_error` 走上一条；`--resume` 目标不存在由 `detectSessionNotFound(stderrTail)` 用两条正则判定（见 §5）。
- **token**：只取 `result.usage` 的 `input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`（避免逐回合 `assistant.usage` 重复计数）。
- **时间戳**：`timestamp` 字段（ISO 字符串或数字毫秒）；assistant 流事件通常没有，由泵回退当前时间。
- **启动清单**：`system/init` 的 `tools[]`、`agents[]`、`skills[]`、`mcp_servers[{name,status}]` 经 `inventoryFacesFromInitEvent` 挂到 `data.inventory.faces`。
- **自检样本**（`initEventSample`）：`{"type":"system","subtype":"init","session_id":"self-check","tools":["Read"],"agents":["general-purpose"],"skills":[],"mcp_servers":[]}`（注释称取自 claude 2.1.226 实跑）。

### 4.2 OpenCode（`opencode/events.ts`）

- **输出格式**：`run --format json`（每行一个 JSON），`--thinking` 让 `reasoning` 事件进入 stdout。
- **识别的 `type`**：`tool_use`、`text`、`reasoning`、`permission.asked`／`permission_asked`（→ `permission_asked`）、`error`、`step_start`、`step_finish`；其他 truthy JSON 一律 `text`。`JSON.parse` 失败或结果为 falsy（`null`／`0`／`""`／`false`）→ `null`。
- **文本**：`part.type === 'text'` 时取 `part.text`；否则 `type === 'text'` 时取顶层 `text`。
- **会话 id**：每个事件的顶层 `sessionID`（与 Claude 不同，无根／侧链区分）。
- **完成**：`observeSystemEvent` 把 `step_finish` 判为 `terminalResult: 'success'`；驱动**没有** `parseTerminalResultError`。
- **token**：`computeTokenDelta` 依次在 `evt`、`evt.part`、`evt.usage`、`evt.step`、`evt.message` 上找 `tokens` 对象或内联 `input_tokens`／`output_tokens`／`prompt_tokens`／`completion_tokens`；缓存计数兼容 `cache.read`／`cache.write`（1.15.5+）与旧的 `cache_read`／`cache_creation`。
- **时间戳**：顶层 `timestamp`（数字）。
- **启动清单**：不在 stdout 里；子进程退出后 `drainFinalEvents` 读 `<runRoot>/inventory.json` 合成一条 `kind: 'startup_inventory'`、`persist: false` 的事件。

### 4.3 归一化事件形状（`runtime/types.ts:129-220`）

```ts
type NormalizedEventKind =
  | 'tool_use' | 'text' | 'reasoning' | 'permission_asked' | 'error'
  | 'step_start' | 'step_finish' | 'startup_inventory'

interface NormalizedEvent {
  kind: NormalizedEventKind
  text?: string | null                       // 贡献给输出信封缓冲的可见文本
  sessionId?: string                         // 根会话原生 id（子代理侧链帧必须省略）
  conversationReset?: { outgoingSessionId: string; newConversationId: string }
  timestamp?: number                         // ms epoch
  tokens?: { input: number; output: number; cacheCreate: number; cacheRead: number }
  rawLine: string                            // 原始 stdout 行，原样落库
  data?: { inventory?: { faces: ObservedInventoryFaces } }
  persist?: boolean                          // 缺省 true；合成事件置 false
}

interface SystemEventObservation {
  runtimeEventType: string | null            // 只接受 /^[A-Za-z0-9._-]{1,64}$/
  terminalResult: 'success' | 'error' | null
}
```

`PersistedEventKind = Exclude<NormalizedEventKind, 'startup_inventory'>`。`stderr` 行不经 `parseEvent`，由 stderr 泵单独写入。

## 5. 会话恢复

| | Claude Code | OpenCode |
|---|---|---|
| 原生 id 来源 | 根帧的 `session_id`（`system/init`、`result`、`conversation_reset`、`parent_tool_use_id === null` 的回合帧） | 每个事件的 `sessionID` |
| 调用方如何捕获 | `runner.ts:1465-1484`：第一次见到 `ev.sessionId` 即记为本次运行的原生 id 并申领租约；之后 id 变化只允许紧随 `conversation_reset` 事件（`outgoingSessionId` 必须等于当前 id），否则抛 `runtime changed native session id without a conversation reset` | 同一段代码，无 reset 语义 |
| 预分配 | `createMcpTestNativeSessionId: randomUUID`；persona 路径把它作为 `--session-id <uuid>` 传入（第 1 轮），后续轮 `mcpTestSessionReference` 返回 `{ resumeSessionId }` | `createMcpTestNativeSessionId: () => null`；恢复完全依赖捕获到的 id |
| 恢复 flag | `--resume <id>`（`buildClaudeSpawn`） | `--session <id>`（`buildCommand`，紧跟 auto flag 之后、`--` 之前） |
| 互斥 | `nativeSessionId` 与 `resumeSessionId` 同时给出 → 抛 `system-agent-native-session-conflict` | — |
| 目标不存在的判定 | stderr 匹配 `/no conversation found with session id/i` 或 `/is not a uuid and does not match any session title/i`（注释称 2026-08-12 本机实测采样） | stderr 匹配 `/\bsession not found\b/i`、`/\bsession\b[^\n]*\bdoes not exist\b/i`、`/\bunknown session\s*id?\b/i`、`/\bno such session\b/i` |
| 子代理会话 | 运行后读 `<configRoot>/projects/<slug>/<sessionId>/subagents/agent-*.jsonl`（含 `subagents/workflows/<wf>/`），`.meta.json` 的 `toolUseId`／`spawnDepth` 决定父子关系；`<slug>` 的官方算法未知，先猜 `cwd.replace(/[/\\:]/g, '-')`，再扫描 `projects/*` 找含 `<sessionId>/subagents` 的目录 | 运行中（`subagentLiveCapture`，`setInterval(pollMs)`）与运行后（`captureChildSessions`）从 `<XDG_DATA_HOME ?? ~/.local/share>/opencode/opencode.db` 只读打开，`SELECT id, parent_id, agent FROM session WHERE parent_id = ?` BFS，`message`／`part` 表按 `time_created, id` 读出并转码成与 stdout 同形的 NDJSON |

## 6. MCP 注入

**输入形状**（`shared/schemas/mcp.ts`）：`{ type: 'local', config: { command: string[], env?: Record<string,string>, timeoutMs?: number } }` 或 `{ type: 'remote', config: { url, headers?: Record<string,string>, oauth?: {clientId?, clientSecret?, scope?, redirectUri?} | false, timeoutMs? } }`，外加 `id`、`name`（`/^[a-z0-9][a-z0-9_-]*$/`）、`enabled`。`local.config.env` 的键名受 `MCP_ENV_NAME_RE` 与 `MCP_ENV_DENY_RE`（拒绝 `LD_`／`DYLD_` 前缀）约束。

**分拣**（`agentInjection.ts:89-120` `partitionMcpsForInjection`）：`enabled === false` 的进入 `declared.skippedDisabledMcps`；同名同 id 去重；同名异 id 都启用 → 抛 `AgentInjectionError('agent-injection-duplicate-mcp-name')`。

### 6.1 OpenCode（内联配置，经环境变量）

`OPENCODE_CONFIG_CONTENT` 的值是 `JSON.stringify` 后的整个对象（`inlineConfig.ts` `buildInlineConfig`）：

```json
{
  "agent": {
    "<name>": {
      "prompt": "<bodyMd（可含记忆块）>",
      "description": "<description>",
      "permission": { "...作者 map，边界合成后 external_directory 在最后" },
      "options": { "outputs": ["..."] },
      "model": "...", "variant": "...", "temperature": 0.2, "steps": 10, "maxSteps": 20
    }
  },
  "mcp": {
    "<name>": { "type": "local", "enabled": true, "command": ["..."], "environment": {"K":"V"}, "timeout": 30000 },
    "<name2>": { "type": "remote", "enabled": true, "url": "https://…", "headers": {"Authorization":"…"}, "oauth": {"…"}, "timeout": 30000 }
  },
  "plugin": [ "file:///abs/plugin", [ "file:///abs/other", { "opt": 1 } ] ],
  "permission": { "external_directory": { "*": "deny", "<dir>/*": "allow" } }
}
```

字段改名：`env → environment`、`timeoutMs → timeout`；`command` 数组原样；**不发** `cwd`（stdio 子进程继承 opencode 进程目录 = 工作树）。`model`／`variant`／`temperature`／`steps`／`maxSteps` 只在 `RuntimeProfile` 对应值非 `null` 时出现。`mcp`／`plugin`／`permission` 键在没有内容时整体省略。序列化后超过 32 KiB 只告警不失败。**凭据（`headers`、`environment`、URL userinfo）随环境变量进入子进程**，代码注释明确「URL userinfo 不做拒绝」；不写任何文件。

### 6.2 Claude Code（`--mcp-config` 文件）

`writeClaudeMcpConfig(dir, { mcpServers })`（`claudeCode/driver.ts:63-71`）：`mkdirSync(runRoot, { recursive: true, mode: 0o700 })`，`writeFileSync('<runRoot>/mcp-config.json', JSON.stringify(...), { mode: 0o600, flag: 'w' })`，然后 argv 追加 `--mcp-config <该路径>`。文件内容：

```json
{
  "mcpServers": {
    "<local-name>":  { "command": "<command[0]>", "args": ["<command[1..]>"], "env": {"K":"V"} },
    "<remote-name>": { "type": "http", "url": "https://…", "headers": {"Authorization":"…"} }
  }
}
```

`timeoutMs` 与 `oauth` 在 Claude 侧**不渲染**。注释记录改为文件传递的原因：内联 JSON 放 argv 曾把 secret 泄漏到 `/proc/<pid>/cmdline`。显式权限（`dontAsk`）下必须同时给 `--allowedTools mcp__<name>__*`，否则每个 MCP 调用都被拒。`--agents` 的子代理 JSON（`{ "<dep>": { "description", "prompt", "model"?, "tools"?: [] } }`）仍然内联在 argv 上。

## 7. 权限映射

agent-workflow **没有** read-only／edit／full 这样的抽象层级。`AgentPermission` 就是 opencode 的 permission map：键为 `read`、`edit`、`glob`、`grep`、`list`、`bash`、`task`、`todowrite`、`question`、`webfetch`、`websearch`、`lsp`、`doom_loop`、`skill`（`OPENCODE_PERMISSION_KEYS`）加平台独占的 `external_directory`；值为动作 `allow | deny | ask`（`OPENCODE_PERMISSION_ACTIONS`）或 `Record<pattern, 动作>`；顶层 `'*'` 是全键基线。

**OpenCode**：作者 map 原样写入 `agent.<name>.permission`；`--auto` 无条件加上（无应答通道）。有工作区边界时 `composeOpencodeBoundary` 把作者的 `'*'` 展开成 `OPENCODE_PERMISSION_KEYS` 的逐键值（`'*'` 本身不再出现），再把 `external_directory = { '*': 'deny', '<runDir>/*': 'allow', '<stagedSkillDirs>/*': 'allow', '<taskMounts>/*': 'allow', '<gitMetaDirs>/*': 'allow', <tmpGlobs>: 'allow', ...作者 external_directory record }` 追加为**最后一个键**（opencode 规则按键序 flatten、findLast 胜）；作者把 `external_directory` 写成标量则视为显式接管、不合成。顶层 `config.permission.external_directory` 用同一合成（作者 = undefined）覆盖 opencode 原生子代理。

**Claude**（`claudeCode/permissionMap.ts`）：

- map 为空 → `--permission-mode bypassPermissions`，无 `--tools`（记 warn `claude-business-unconstrained`）。
- map 非空 → `--permission-mode dontAsk --tools <列表>`，列表由表 `TABLE` 计算：`read → Read`、`glob → Glob`、`grep → Grep`、`edit → Edit, Write, NotebookEdit`、`bash → Bash`、`task → Task`、`webfetch → WebFetch`、`websearch → WebSearch`、`skill → Skill`；`list`、`external_directory`、`todowrite`、`question`、`lsp`、`doom_loop` 映射为空。`'*': allow` 先把 11 个可授予工具全部加入，随后显式键覆盖；未知键不授予并告警；`ask` 视为 `deny` 并告警；`Record<pattern, 动作>` 按「任一 pattern 为 allow 即整工具加载」降级并告警；最终为空集时仍发 `--tools ""`（禁用全部内置工具）并告警。输出顺序固定为表序。
- 子代理（`--agents` 条目的 `tools`）：父有载入集时，子 = 子自身 gate ∩ 父集（去掉 `Task`）；子无声明则继承父集去 `Task`；父无载入集（bypass）则条目不带 `tools`。
- 作者 `external_directory` 中形如字面目录的 `allow` 项（可去掉结尾 `/*`；`~/`、`$HOME/` 展开）转为 Claude 的 `settings.permissions.additionalDirectories` ＋ `Edit(//<dir>/**)` allow 规则；含 `*`／`?` 的 glob 归入 `lossy` 只告警。

## 8. 沙箱相关

| 项 | 代码事实 |
|---|---|
| `IS_SANDBOX=1` | 只在 `RuntimeProfile.isSandbox === true` 时注入（驱动声明 `acceptsSandboxCompatibilityMarker: true`）；先剔除环境中任何大小写形式的 `IS_SANDBOX`。注释反复声明这是「Claude CLI 兼容标记，不是平台 OS 沙箱，也不启用沙箱」。CLI 收到它做什么：unknown from code |
| `--dangerously-skip-permissions` | 在 `CLAUDE_PLATFORM_OWNED_FLAGS` 中（禁止经 `extraArgs` 传入）；平台**从不**对 Claude 发这个 flag，而用 `--permission-mode bypassPermissions`／`dontAsk`。对 OpenCode，它只是 < 1.18.0 版本的 `--auto` 旧拼写（`run --dangerously-skip-permissions`） |
| `--settings <runRoot>/settings.json` | 仅业务路径（`taskMounts` 已定义且过滤空串后非空）写出并传入。内容（`renderClaudeBoundary`）：`{ "sandbox": { "enabled": true, "autoAllowBashIfSandboxed": false, "filesystem": { "allowWrite": [taskMounts…, gitMetaDirs…, toolchainCacheDirs()…, authorAllowDirs…] } }, "permissions"?: { "additionalDirectories"?: [taskMounts…, authorAllowDirs…], "allow"?: ["Edit(//<dir>/**)"…], "deny"?: ["Edit(//<sibling>/**)", "Read(//<sibling>/**)"…] } }`。`permissions.additionalDirectories`／`allow` 只在显式权限（`dontAsk`）下出现；`deny` 列出 `<appHome>/iso/*` 与 `<appHome>/worktrees/*/*` 下不属于本任务的目录（`scanSiblingTaskRoots`）。刻意**不发** `denyWrite`、**不发** `allowUnsandboxedCommands`、**不发**读面 deny |
| `autoAllowBashIfSandboxed: false` | 注释：Claude 默认 true 会让开沙箱后 Bash 自动放行、反而放宽 `dontAsk` 节点的越界读，故钉 false |
| 宿主可用性 | `claudeWriteBoundaryAvailability(platform, hasExecutable)`：`darwin` 恒可用；`linux` 需要 `bwrap` 与 `socat` 都在 PATH（`Bun.which`），否则 `missing-dependencies:<list>`；其他平台 `unsupported-platform`。不可用时只 warn `claude-workspace-boundary-unavailable`，**照常 spawn** |
| `--add-dir` | 平台独占 flag（会把边界拿走的目录还回去），禁止经 `extraArgs` 传入 |
| 规则可表达性 | 目录名含 `( ) * ? [ ] \` 时不生成 `Edit(...)`／`Read(...)` 规则（gitignore 语法无转义），只保留 `allowWrite`／`additionalDirectories` 并回调 `onUnexpressibleBoundaryDirs` |
| `taskMounts` 为空数组 | `buildClaudeSpawn` 注释「fail OPEN」：不写 settings 文件、不传 `--settings` |

**「不经过 `taskMounts` 的路径」在代码中的含义**：`RuntimeDriver.buildSpawn(ctx)` 以 `ctx.taskMounts === undefined` 作为唯一分支条件（`claudeCode/driver.ts:600-605`、`opencode/driver.ts:430-435`）——未定义走 `assembleClaudePersonaSpawn`／`assembleOpencodePersonaSpawn`（system／persona 路径：无 `settings.json`、无 `--settings`、无边界、无 skill／agent 投影、Claude 侧无 `--tools`，`--permission-mode bypassPermissions`，可用 `--session-id`），已定义走业务路径（带边界、skills、`--agents`、`--tools`）。`types.ts` 对 `AgentSpawnContext.taskMounts` 的注释：「Omitted = no boundary (system faces, v1)」。

**对 CrewStation 的含义**：「任务容器内关闭 Claude 内置沙箱」= 不写出含 `sandbox.enabled: true` 的 `settings.json`。由于 `settings.permissions.deny/allow/additionalDirectories` 与 `sandbox` 写在同一文件里，若仍想保留权限层规则需拆开渲染；opencode 侧的 `external_directory` 合成与 Claude 沙箱无关，可独立取舍。未启用 `--settings` 时 Claude 自身的默认沙箱状态：unknown from code（代码只说「Omitted → argv/behavior byte-identical to pre-RFC-281」）。

## 9. HOME／XDG／配置目录

### 9.1 Claude Code

| 名称 | 用途 |
|---|---|
| `CLAUDE_CONFIG_DIR`（`DEFAULT_CONFIG_DIR_PROFILE['claude-code'].env`） | 平台**不设置**；只在读取子代理转录时作为候选根之一读取 |
| `HOME`、`USERPROFILE` | `spawnHome()` 依次读取（非空即用）以推断子进程的 `~`，否则 `os.homedir()` |
| `~/.claude`（`.name` 默认值） | 用户级配置根候选；转录在 `<root>/projects/<cwd-slug>/<sessionId>/subagents/agent-*.jsonl`（`.meta.json` 同名旁置；2026.8 起还有 `subagents/workflows/<wf>/`） |
| `<worktree>/.claude/skills/<name>/`、`<worktree>/.claude/agents/<name>.md` | 项目级投影（leaf 名来自 `configDir.name`，可被 fork 改名）；spawn 后清理 |
| `<runRoot>/system.md`、`settings.json`、`mcp-config.json`、`claude-managed-skill-attachments/` | 每次运行的产物目录（agent-workflow 里 `<appHome>/runs/<taskId>/<nodeRunId>`） |
| `PWD`、`IS_SANDBOX`、`GIT_AUTHOR_*`、`GIT_COMMITTER_*` | 见 §3.1 |
| `.claude-plugin` | staged skill 树里被排除的条目名（否则会被 Claude 当插件加载） |

### 9.2 OpenCode

| 名称 | 用途 |
|---|---|
| `OPENCODE_CONFIG_DIR`（可由 `configDir.env` 改名） | 设为 `<runRoot>/.opencode`（leaf 名 `configDir.name`）；staged skills 在其 `skills/` 下 |
| `OPENCODE_CONFIG_CONTENT` | 内联配置 JSON（§6.1） |
| `OPENCODE_PERMISSION` | 从子进程环境剔除（opencode 会在内联配置之后合并它） |
| `OPENCODE_AW_INVENTORY_OUT` | 清单插件的输出文件路径 |
| `AGENT_WORKFLOW_OPENCODE_BIN` | persona 路径的二进制回退 |
| `OPENCODE_PURE` | 平台读取（`'1'`／`'true'`）以把清单缺失归类为 `opencode-pure-mode` |
| `OPENCODE_TEST_HOME` | 覆盖 home，用于定位 SQLite（测试隔离） |
| `XDG_DATA_HOME`（默认 `~/.local/share`） | `<xdgData>/opencode/opencode.db`（会话库）、`<xdgData>/opencode/tool-output/`（截断的工具输出，边界需放行） |
| `XDG_CONFIG_HOME`（默认 `~/.config`） | 机器级 skill 根 `<xdgConfig>/opencode/skill`、`skills`；另有 `~/.claude/skills`、`~/.agents/skills`、`~/.opencode/skill`、`~/.opencode/skills` |
| `os.tmpdir()/opencode`、`os.tmpdir()/*` | 边界的 tmp 放行 glob |
| `PWD`、`GIT_AUTHOR_*`、`GIT_COMMITTER_*` | 见 §3.2 |

### 9.3 平台侧（agent-workflow 自身，CrewStation 需替换）

`AGENT_WORKFLOW_HOME`（默认 `~/.agent-workflow`）→ `Paths.runsDir = <appHome>/runs`、`<appHome>/iso`、`<appHome>/worktrees`（兄弟任务扫描）。`XDG_CACHE_HOME`（默认 `~/.cache`）只用于 `toolchainCacheDirs()` 生成 Claude 沙箱 `allowWrite`：`~/.bun/install/cache`、`~/.npm/_cacache`、`~/.npm/_logs`、`~/.cargo/registry`、`~/.cargo/git`、`~/.pnpm-store`、`~/.yarn/berry/cache`、`<cache>/pip`、`<cache>/uv`、`<cache>/go-build`、`~/go/pkg/mod`。

## 10. 交互式流（Q22）

代码的答案是**否**：没有任何地方让 CLI 进程存活并持续向它的 stdin 投递后续消息。证据：

- `SpawnPlan.stdin` 与 `ManagedProcessRequest.stdin` 的类型只有 `{ mode: 'ignore' }` 与 `{ mode: 'pipe'; data: string }` 两种（`types.ts:249`、`managedProcess.ts:74`）；`pipe` 模式在 `managedProcess.ts:596-607` 一次 `write(data)` 后立即 `end()`。launcher 路径同理（`managedProcessLauncher.ts:558-562`）。
- 全仓非测试源码中 `--input-format` 只出现一次，即 `CLAUDE_PLATFORM_OWNED_FLAGS` 的禁止列表（`claudeCode/spawn.ts:74`），从未被拼进 argv；`stream-json` 只作为 `--output-format` 的值出现。
- OpenCode 的 prompt 走 argv 位置参数，stdin 为 `ignore`。
- 唯一的多轮对话场景（MCP 测试台 `services/mcpRuntimeTest.ts:1428-1475`）每轮调用一次 `runSystemAgent`（`prompt: turn.promptText`），每轮新建 `AgentSpawnContext`（运行根 `<runDir>/turns/<turn.id>`），Claude 第 1 轮 `--session-id <uuid>`、之后 `--resume <uuid>`；OpenCode 用捕获到的 `sessionID` 走 `--session`。即多轮 = 多个 one-shot 进程 ＋ 原生会话恢复。

两个 CLI 是否支持超出代码所用的长驻 stdin 流模式（例如 Claude 的 `--input-format stream-json`）：unknown from code。CrewStation 开发会话要求的「多个并行流式交互 agent」在复制单元里没有现成实现，只能在 T0.4 原型里另行验证。

## 11. 目标布局、文件对照与依赖反转

### 11.1 目标布局（`packages/agent-drivers/`）

按概念分组；每个目录 ≤ 20 个源码文件；只有包根一个 `index.ts`；不使用 `utils`／`helpers`／`common`／`shared`／`types` 文件名。

```text
packages/agent-drivers/
├─ package.json                      # dependencies: @crewstation/kernel, @crewstation/contracts, yaml, zod
├─ index.ts                          # 唯一公开面（命名导出，不 export *）
├─ contract/                         # ← runtime/types.ts（971 行）按概念拆分
│  ├─ driver.ts                      # RuntimeKind, RuntimeDriver, RuntimeDriverCapabilities, DeclarationFace, RuntimeBinaryConfig
│  ├─ events.ts                      # NormalizedEvent(+Kind/Data/TokenDelta), PersistedEventKind, SystemEventObservation, TerminalResultObservation, SystemAgentOutputEvidence, RuntimeTokenUsage
│  ├─ spawn.ts                       # AgentSpawnContext, AgentSpawnPlan, SpawnPlan, AgentInjectionSpecV1, RenderedInjectionV1, ResolvedSkill, SkillSource, BoundaryHostProbe
│  ├─ spawnLegacy.ts                 # SystemAgentSpawnContext, BusinessNodeSpawnContext（@deprecated，与翻译层同进退）
│  ├─ probe.ts                       # RuntimeProbe, ProbeOpts, RuntimeModel, RuntimeModelList, ListModelsOpts
│  └─ capture.ts                     # SessionCaptureContext, FinalEventContext, InventoryReadContext, SystemAgentSessionSweepContext／Outcome, StartupInventory, DeclaredRuntimeCapabilities, DistillSessionCapture*（若保留）
├─ ports/                            # 本包要求宿主（runtimes/task 的 TaskRunner）提供的接口
│  ├─ sessionCapturePersistence.ts   # ← modules/task-execution/application/ports/runtimeSessionCapturePersistence.ts
│  ├─ sessionEventSink.ts            # ← services/sessionEventSink.ts
│  ├─ readonlySqlite.ts              # ← platform/persistence/sqlite/readonlySqliteDatabase.ts（接口 ＋ bun:sqlite 默认实现）
│  └─ gitMetaDirs.ts                 # ← util/git.ts gitMetaDirsFor：端口 ＋ 直接 Bun.spawn(['git','rev-parse',…]) 的默认实现
├─ schema/                           # ← @agent-workflow/shared 的最小子集（zod 4）
│  ├─ agent.ts                       # Agent（裁剪到驱动实际读取的字段）、AgentPermissionSchema
│  ├─ opencodePermission.ts          # OPENCODE_PERMISSION_ACTIONS／KEYS／WILDCARD_KEY
│  ├─ mcp.ts                         # McpLocalConfigSchema, McpRemoteConfigSchema, McpSchema（去 ACL／乐观锁字段）, MCP_ENV_*
│  ├─ plugin.ts                      # RuntimePlugin（若保留 opencode 插件面）
│  ├─ runtimeProfile.ts              # RuntimeProfile, EMPTY_RUNTIME_PROFILE
│  ├─ configDirProfile.ts            # RuntimeConfigDirProfile, DEFAULT_CONFIG_DIR_PROFILE, RESERVED_SPAWN_ENV
│  ├─ declaredManifest.ts            # DeclaredInjectionManifestSchema
│  └─ inventory.ts                   # InventorySnapshot*、ObservedInventory*、FaceSupport、InventoryDeclaration、RuntimeInventoryPayload、inventoryFacesFromSnapshot、normalizeInventoryRaw、inventoryReasonCode
├─ process/                          # ← execution/managedProcess.ts、agentProcess.ts、util/process.ts 的 POSIX 子集
│  ├─ managedProcess.ts              # runManagedProcess 主体（去 Windows spool 与 launcher 分支）
│  ├─ killEscalation.ts              # escalate／timeout／reap-deadline 状态机（自 managedProcess 拆出以守住 600 行）
│  ├─ streamPump.ts                  # pump()、MANAGED_PROCESS_MAX_LINE_CHARS／MAX_STREAM_CHARS、appendBounded
│  ├─ processTree.ts                 # killProcessTree, isProcessTreeAlive, awaitProcessTreeQuiesced（POSIX 进程组）
│  ├─ agentProcess.ts                # runAgentProcess
│  ├─ versionProbe.ts                # spawnVersionProbe, readStreamCapped, reapDetachedGroup, DEFAULT_VERSION_PROBE_TIMEOUT_MS
│  ├─ spawnDiagnostics.ts            # explainSpawnEnoent, outputTail
│  ├─ semver.ts                      # extractVersion, compareSemver
│  └─ diagnosticsMask.ts             # maskDiagnosticsText
├─ fs/                               # 路径安全（投影与清理用）
│  ├─ safePath.ts                    # safeJoin, assertWriteAncestorInside（错误改用 kernel validation()）
│  ├─ fileIdentity.ts                # dev/ino 同一性判定（← util/fileTrust 的两个 *ForHost 函数，去 Windows 分支）
│  └─ lexicalPath.ts                 # isLexicallyInside（POSIX）
├─ injection/                        # ← execution/agentInjection.ts（403 行）＋ runtime 根下的共享件
│  ├─ mcpInjection.ts                # AgentInjectionError, partitionMcpsForInjection, renderOpencodeMcpEntry, renderClaudeMcpServerEntry, render{Opencode,Claude}McpInjection
│  ├─ declaredManifest.ts            # emptyDeclaredManifest, declareSkills／Subagents／Plugins, managedSkillsOf, weaveMemoryBlock, deriveClaudeDroppedParams
│  ├─ opencodeAgentEntry.ts          # renderOpencodeAgentEntry
│  ├─ claudeSubagentEntries.ts       # ClaudeAgentEntry, ClaudeAgentsOpts, renderClaudeSubagentEntries
│  ├─ stageSkills.ts                 # ← runtime/stageSkills.ts
│  ├─ injectionIdentity.ts           # ← runtime/injectionIdentity.ts
│  ├─ spawnHead.ts                   # ← runtime/head.ts
│  └─ spawnContextTranslation.ts     # ← runtime/spawnCtx.ts
└─ drivers/
   ├─ registry.ts                    # ← runtime/index.ts（getRuntimeDriver, tryGetRuntimeDriver, RUNTIME_KINDS, isKnownRuntimeKind；不再做再导出）
   ├─ selfCheck.ts                   # ← runtime/selfCheck.ts（去 resourcePolicy 段）
   ├─ claudeCode/
   │  ├─ driver.ts                   # claudeCodeDriver 对象、buildSpawn 门面、renderClaudeInjection
   │  ├─ personaAssembly.ts          # assembleClaudePersonaSpawn, writeClaudeMcpConfig
   │  ├─ businessAssembly.ts         # assembleClaudeBusinessSpawn
   │  ├─ argv.ts                     # ← spawn.ts：CLAUDE_HEADLESS_BASE_ARGV, CLAUDE_PLATFORM_OWNED_FLAGS, claudeExplicitPermissionArgv, buildClaudeSpawn
   │  ├─ env.ts                      # ← spawn.ts：assembleClaudeEnv
   │  ├─ events.ts                   # ← events.ts
   │  ├─ permissionMap.ts            # ← permissionMap.ts
   │  ├─ subagents.ts                # ← inject.ts（toClaudeAgents）
   │  ├─ boundary.ts                 # ← boundary.ts（沙箱关闭后视裁定保留或删除）
   │  ├─ skillAttachments.ts         # ← config.ts renderClaudeManagedSkillAttachments
   │  ├─ worktreeProjection.ts       # ← config.ts stageClaudeWorktreeSkills／stageClaudeWorktreeAgents
   │  ├─ sessionCapture.ts           # ← sessionCapture.ts
   │  ├─ probe.ts                    # ← probe.ts
   │  └─ models.ts                   # ← models.ts
   └─ opencode/
      ├─ driver.ts                   # opencodeDriver 对象、buildSpawn 门面、renderOpencodeInjection、可选能力
      ├─ personaAssembly.ts          # assembleOpencodePersonaSpawn
      ├─ businessAssembly.ts         # assembleOpencodeBusinessSpawn
      ├─ argv.ts                     # ← spawn.ts：buildCommand, resolveAutoApproveFlag, MAX_OPENCODE_PROMPT_BYTES
      ├─ env.ts                      # ← spawn.ts：buildOpencodeEnv, buildOpencodeSpawn
      ├─ events.ts                   # ← events.ts
      ├─ inlineConfig.ts             # ← inlineConfig.ts
      ├─ boundary.ts                 # ← boundary.ts ＋ BoundaryCtx／ExternalDirRule 类型
      ├─ pluginSpec.ts               # ← pluginSpec.ts
      ├─ inventoryPlugin.ts          # ← plugin/index.ts materializeInventoryPlugin（去 embed 表，从 import.meta.dir 读 .mjs）
      ├─ inventoryTranscode.ts       # ← plugin/transcoder.ts
      ├─ awInventoryDump.mjs         # ← plugin/aw-inventory-dump.mjs（原样，作为随包资产）
      ├─ inventoryRead.ts            # ← inventory.ts readSnapshotFromRunDir（去 runRootFor）
      ├─ sessionCapture.ts           # ← sessionCapture.ts
      ├─ sessionWalk.ts              # ← sessionWalk.ts
      ├─ subagentLiveCapture.ts      # ← subagentLiveCapture.ts
      ├─ models.ts                   # ← models.ts
      ├─ probe.ts                    # ← util.ts（改名；probeOpencode, detectOpencodeSessionNotFound）
      └─ versionRegistry.ts          # ← versionRegistry.ts
```

### 11.2 源文件 → 目标文件对照

| 源文件 | 目标文件 | 处置 |
|---|---|---|
| `runtime/types.ts` | `contract/driver.ts`、`contract/events.ts`、`contract/spawn.ts`、`contract/spawnLegacy.ts`、`contract/probe.ts`、`contract/capture.ts` | 拆分（971 → 6 个文件） |
| `runtime/index.ts` | `drivers/registry.ts` ＋ 包根 `index.ts` 的具名导出 | 改名（非根 `index.ts` 禁用） |
| `runtime/head.ts` | `injection/spawnHead.ts` | 改名 |
| `runtime/spawnCtx.ts` | `injection/spawnContextTranslation.ts` | 改名 |
| `runtime/stageSkills.ts` | `injection/stageSkills.ts` | 原样 |
| `runtime/injectionIdentity.ts` | `injection/injectionIdentity.ts` | 原样 |
| `runtime/selfCheck.ts` | `drivers/selfCheck.ts` | 删除 `DISABLED_RESOURCE_POLICY` 相关段 |
| `claudeCode/driver.ts` | `drivers/claudeCode/driver.ts`、`personaAssembly.ts`、`businessAssembly.ts` | 拆分（607 → 3） |
| `claudeCode/spawn.ts` | `drivers/claudeCode/argv.ts`、`env.ts` | 拆分 |
| `claudeCode/events.ts` | `drivers/claudeCode/events.ts` | 原样 |
| `claudeCode/permissionMap.ts` | `drivers/claudeCode/permissionMap.ts` | 原样 |
| `claudeCode/inject.ts` | `drivers/claudeCode/subagents.ts` | 改名 |
| `claudeCode/boundary.ts` | `drivers/claudeCode/boundary.ts` | 依 §8 裁定：沙箱关闭后可能只剩 `claudeExpressibleAuthorDirs` 或整体删除 |
| `claudeCode/config.ts` | `drivers/claudeCode/skillAttachments.ts`、`worktreeProjection.ts` | 拆分 |
| `claudeCode/sessionCapture.ts` | `drivers/claudeCode/sessionCapture.ts` | 原样 |
| `claudeCode/probe.ts` | `drivers/claudeCode/probe.ts` | 原样 |
| `claudeCode/models.ts` | `drivers/claudeCode/models.ts` | 原样（模型表需人工维护） |
| `opencode/driver.ts` | `drivers/opencode/driver.ts`、`personaAssembly.ts`、`businessAssembly.ts` | 拆分（489 → 3，便于去掉 `AGENT_WORKFLOW_OPENCODE_BIN`、`OPENCODE_PURE` 读取） |
| `opencode/spawn.ts` | `drivers/opencode/argv.ts`、`env.ts` | 拆分 |
| `opencode/events.ts` | `drivers/opencode/events.ts` | 原样 |
| `opencode/inlineConfig.ts` | `drivers/opencode/inlineConfig.ts` | 去掉 `buildInlineAgentEntry` 别名再导出 |
| `opencode/boundary.ts` | `drivers/opencode/boundary.ts` | 并入 `BoundaryCtx`、`ExternalDirRule` 类型 |
| `opencode/pluginSpec.ts` | `drivers/opencode/pluginSpec.ts` | 原样（若保留插件面） |
| `opencode/plugin/index.ts` | `drivers/opencode/inventoryPlugin.ts` | 去 embed 表与 `export *` |
| `opencode/plugin/transcoder.ts` | `drivers/opencode/inventoryTranscode.ts` | 改名 |
| `opencode/plugin/aw-inventory-dump.mjs` | `drivers/opencode/awInventoryDump.mjs` | 原样资产 |
| `opencode/inventory.ts` | `drivers/opencode/inventoryRead.ts` | 删除 `runRootFor` |
| `opencode/models.ts` | `drivers/opencode/models.ts` | 原样 |
| `opencode/util.ts` | `drivers/opencode/probe.ts` | 改名（禁用名） |
| `opencode/versionRegistry.ts` | `drivers/opencode/versionRegistry.ts` | 原样 |
| `opencode/sessionCapture.ts` | `drivers/opencode/sessionCapture.ts` | 原样 |
| `opencode/sessionWalk.ts` | `drivers/opencode/sessionWalk.ts` | 原样 |
| `opencode/subagentLiveCapture.ts` | `drivers/opencode/subagentLiveCapture.ts` | 原样 |
| `opencode/distillSessionCapture.ts` | — | **不复制**（记忆蒸馏属知识提炼，CrewStation 明确不做） |
| `execution/agentInjection.ts` | `injection/mcpInjection.ts`、`declaredManifest.ts`、`opencodeAgentEntry.ts`、`claudeSubagentEntries.ts` | 拆分（403 → 4） |
| `execution/agentProcess.ts` | `process/agentProcess.ts` | 原样 |
| `execution/managedProcess.ts` | `process/managedProcess.ts`、`killEscalation.ts`、`streamPump.ts` | 删除 Windows spool（`windowsOutputSpoolStream`、`readWindowsOutputSpoolChunk`、spool 接线）与 launcher 协议（`stripLauncherProtocol`、`consumeLauncherControlLine`、激活帧写入）后再拆；三段拆出后各自 < 600 行需在复制时实测 |
| `execution/managedProcessLauncher.ts` | — | **建议不复制**（见 §12 第 5 条；若裁定保留耐久 PID 收据，则只复制 POSIX 激活帧路径） |
| `shared/schemas/agent.ts` | `schema/agent.ts`、`schema/opencodePermission.ts` | 裁剪到驱动读取的字段与权限常量 |
| `shared/schemas/mcp.ts` | `schema/mcp.ts` | 裁剪 ACL／乐观锁／Create-Update 请求体 |

### 11.3 依赖反转清单

| # | 单元外依赖（agent-workflow） | 被谁引用 | 替代方案 |
|---|---|---|---|
| 1 | `@/util/log`（`Logger` 类型、`createLogger`） | 15 个文件 | 用 kernel `Logger`（同样的 `debug/info/warn/error(message, fields)`；复制单元内没有调用 `child()`）；删除模块级 `createLogger('x')` 单例，一律从上下文的 `log` 字段注入；`managedProcess` 的 `noopLog` 改用 kernel `noopLogger` |
| 2 | `@/util/safePath`（`safeJoin`、`assertWriteAncestorInside`） | `claudeCode/config.ts` | 复制到 `fs/safePath.ts`（约 100 行），`ValidationError` 改为 kernel `validation()`；不进 kernel（kernel 零 IO） |
| 3 | `@/util/fileTrust`（`assertSameDirectoryIdentityForHost`、`assertSameFileIdentityForHost`） | `claudeCode/config.ts` | 只复制 dev/ino 比较的两个函数到 `fs/fileIdentity.ts`，去掉 Windows 分支 |
| 4 | `@/util/platformExec`（`platformSpawnOptionsForHost`、`isLexicallyInsideForHost`） | `managedProcess`、`launcher`、`claudeCode/boundary`、`workspaceBoundary` | `windowsHide` 选项整体删除；`isLexicallyInside` 以 POSIX 版复制到 `fs/lexicalPath.ts` |
| 5 | `@/util/process`（`killProcessTree`、`adoptSpawnedProcessTree`、`releaseProcessTreeOwnership`、`awaitProcessTreeQuiesced`、`spawnVersionProbe`、`DEFAULT_VERSION_PROBE_TIMEOUT_MS`） | `managedProcess`、两个 probe、`opencode/models` | 复制 POSIX 分支到 `process/processTree.ts`、`process/versionProbe.ts`；`adopt/release`（Windows Job Object）与 `killStaleRunProcessTree`（守护进程孤儿收割）不复制，`util/windowsJobObject.ts` 不复制 |
| 6 | `@/util/spawnDiagnostics`（`explainSpawnEnoent`） | `managedProcess` | 复制（66 行）到 `process/spawnDiagnostics.ts`；保留对 `Bun.which` 的使用 |
| 7 | `@/util/semver`（`extractVersion`、`compareSemver`） | 两个 probe、`opencode/spawn` | 复制（37 行）到 `process/semver.ts` |
| 8 | `@/util/git`（`gitMetaDirsFor`，位于 3538 行的 `git.ts`） | 两个 driver | 端口 `ports/gitMetaDirs.ts`：`GitMetaDirsResolver = (worktreePath) => Promise<string[]>`；默认实现直接 `Bun.spawn(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir' \| '--git-dir'])`，不引入 `runGit` |
| 9 | `@/util/paths`（`Paths.runsDir`） | `opencode/inventory.ts` | 删除（只被 REST 辅助 `runRootFor` 使用；`readSnapshotFromRunDir` 已显式接收 `runDir`） |
| 10 | `@/services/sessionEventSink`（`SystemAgentEventSinkV1`） | `opencode/sessionCapture` | 端口 `ports/sessionEventSink.ts`（纯接口；`types.ts` 里已有结构等价的 `SystemAgentSessionSweepContext.sink`） |
| 11 | `@/modules/task-execution/application/ports/runtimeSessionCapturePersistence`（3 个方法） | `types.ts`、两个 sessionCapture、`subagentLiveCapture` | 端口 `ports/sessionCapturePersistence.ts`；由 TaskRunner 实现为向 `cs-session` 的 WS 转发；`kind` 类型改引本包 `contract/events.ts` |
| 12 | `@/platform/persistence/sqlite/readonlySqliteDatabase`（接口 ＋ `bun:sqlite`） | opencode 会话捕获 4 个文件 | 端口 `ports/readonlySqlite.ts`：接口原样，默认实现用 `bun:sqlite`（Bun 内置，不是工作区包） |
| 13 | `@/services/execution/resourcePolicy`（`DISABLED_RESOURCE_POLICY` 等） | `selfCheck.ts` | 删除（agent-workflow 的插件／MCP 禁用产品策略）；自检只保留驱动声明面检查 |
| 14 | `@/services/execution/workspaceBoundary`（`BoundaryCtx`、`ExternalDirRule`、`scanSiblingTaskRoots`、`toolchainCacheDirs`、`resolveBoundaryMounts`） | 两个 driver、`opencode/boundary`、`inlineConfig` | 两个类型并入 `drivers/opencode/boundary.ts`；`scanSiblingTaskRoots`（依赖 `<appHome>/iso`／`worktrees` 布局；CrewStation 一容器一任务无兄弟）与 `toolchainCacheDirs`（只喂 Claude 沙箱 `allowWrite`）不复制 |
| 15 | `@/services/runtimeRegistry`（`RuntimeProfile` 类型，6 个字段） | `types.ts`、`agentInjection`、`inlineConfig` | `schema/runtimeProfile.ts` |
| 16 | `@/embed.generated`（`PLUGIN_FILES`、`MANAGED_PROCESS_LAUNCHER_SOURCE`） | `plugin/index.ts`、`launcher` | 删除；`.mjs` 作为随包资产由 `import.meta.dir` 定位（Bun 单文件编译若在 CrewStation 出现再议） |
| 17 | `@agent-workflow/shared`：`Agent`、`Mcp`、`AgentPermission`、`OPENCODE_PERMISSION_*`、`Plugin` | 多处 | `schema/agent.ts`、`schema/mcp.ts`、`schema/opencodePermission.ts`、`schema/plugin.ts`（裁剪版）；这些形状是否应上升到 `@crewstation/contracts`（Manifest `tasks` 段的 `agentProfile`）需作者裁定 |
| 18 | `@agent-workflow/shared`：`DeclaredInjectionManifest`、`RuntimeConfigDirProfile`／`DEFAULT_CONFIG_DIR_PROFILE`／`RESERVED_SPAWN_ENV`、Inventory 家族（`InventorySnapshot*`、`normalizeInventoryRaw`、`inventoryReasonCode`、`ObservedInventory*`、`FaceSupport`、`InventoryDeclaration`、`RuntimeInventoryPayload`、`inventoryFacesFromSnapshot`、`InventoryAgent/Skill/Mcp/Plugin`）、`OpencodeModel` | `types.ts`、events、inventory、transcoder、driver | `schema/declaredManifest.ts`、`schema/configDirProfile.ts`、`schema/inventory.ts`；`OpencodeModel` 由 `contract/probe.ts` 的 `RuntimeModel` 覆盖 |
| 19 | `@agent-workflow/shared`：`isAgentNodeKind`、`envNameMatches`、`JS_TIMER_MAX_MS`、`maskDiagnosticsText` | `opencode/inventory`、`opencode/driver`、`opencode/spawn`、`managedProcess`、两个 sessionCapture | `isAgentNodeKind`（工作流节点种类表）删除，改为布尔参数；`envNameMatches` 删除（POSIX 精确 `delete env[key]`）；`JS_TIMER_MAX_MS = 2_147_483_647` 就地常量；`maskDiagnosticsText`（12 行）复制到 `process/diagnosticsMask.ts` |
| 20 | npm `yaml`、`zod` | `claudeCode/config.ts`、schema | `yaml` 保留为本包依赖（也可手写 4 键 frontmatter）；`zod` 从 ^3 移植到 CrewStation 锁定的 4.6.2 |

## 12. 风险与未知

1. **zod 3 → zod 4**（已知）：agent-workflow 的 schema 基于 zod ^3.23.8，CrewStation `contracts` 锁定 4.6.2；`z.record(key, value)`、`discriminatedUnion`、`superRefine`、`.strict()` 在 4 中的行为需逐个核对。
2. **Bun 版本**（已知观测）：agent-workflow 声明 `bun >=1.4.0`，代码注释多处引用「Bun 1.4 on Windows」行为；本机 `bun --version` 为 1.3.13。`Bun.spawn` 的 `detached`、`Bun.Subprocess` 类型在 CrewStation 锁定版本（T0.2）上需重新验证。
3. **CLI 版本漂移**（unknown from code 之外的部分为已知）：Claude 事件形状按注释验证于 2.1.193／2.1.202／2.1.226／2.1.227，`--resume` 报错措辞采样于 2026-08-12；OpenCode `--auto` 改名发生在 1.18.0，`opencode.db` 的 `session`／`message`／`part` 表结构验证于 1.15.x，`--thinking`／`--format json` 语义按 1.x。CrewStation 锁定的具体版本是否仍满足这些形状：unknown from code，必须在 M0 原型实测。
4. **Windows 代码删除与测试搬运**：复制单元的 125 个相关测试文件里，字节级对拍锁（`rfc282-b1a-unified-spawn-parity`、`opencode-spawn-pwd-env` 的源码字面锁等）与 Windows 用例无法照搬；删除 Windows 分支后 `managedProcess` 各段是否落在 600 行内需复制时实测。
5. **预激活 launcher 的取舍**（需裁定）：`managedProcessLauncher.ts` 解决的是「守护进程崩溃后 PID 收据已落库、孤儿可被识别」；CrewStation 任务容器以 `tini` 为 PID 1、TaskRunner 常驻，容器消亡即收割孤儿，但 **TaskRunner 自身在存活容器内重启** 时仍会留下无人认领的 CLI 进程——是否需要耐久 PID 收据是一个开放问题。
6. **`Agent`／`Mcp` 形状的归属**（需裁定）：驱动只读 `name`、`description`、`bodyMd`、`permission`、`outputs` 与 MCP 的 `command/env/timeoutMs/url/headers/oauth`；这些是否进入 `@crewstation/contracts`（作为 Manifest `tasks` 段 `agentProfile` 的一部分）还是留在 `agent-drivers/schema/`，决定了 `packages/contracts` 与本包的依赖方向。
7. **清单／启动验证面的价值**（需裁定）：`aw-inventory-dump.mjs`、转码器、`schema/inventory.ts`、`selfCheck.ts`、`drainFinalEvents` 合计约 900 行只服务「平台声明注入了什么 vs 运行时实际加载了什么」的对账；CrewStation v1 是否需要该面未定。
8. **凭据暴露面**（已知）：OpenCode 的 MCP `headers`／`environment` 随 `OPENCODE_CONFIG_CONTENT` 环境变量进入子进程（同 UID 进程可读 `/proc/<pid>/environ`）；Claude 的 `--agents` JSON（含子代理 prompt 正文）内联在 argv 上（`/proc/<pid>/cmdline` 全局可读）；`mcp-config.json` 虽 0600 但落在运行目录。CrewStation 任务容器内 CLI 进程与 TaskRunner 是否同 UID、开发会话容器内多个并行 agent 是否互相可见：unknown from code（CrewStation 尚无实现）。
9. **交互式流（Q22）**：复制单元只有 one-shot 模式；开发会话要求的常驻流式交互 agent 没有现成实现，CLI 是否支持：unknown from code。
10. **Claude 子代理转录定位**（已知脆弱）：依赖扫描 `projects/*` 找含 `<sessionId>/subagents` 的目录，因为 cwd → 目录名的官方算法私有且会变；`~/.claude` 需在容器内可写且随 PV 保留才有内容。
11. **OpenCode 会话库并发读取**：运行中轮询用 `bun:sqlite` 只读打开正在被 opencode 写入的 `opencode.db`；WAL／锁行为在容器 PV 上如何：unknown from code。
12. **`IS_SANDBOX` 语义**：代码只把它当「兼容标记」，Claude CLI 收到后的实际行为：unknown from code。
13. **静态模型表**：`claudeCode/models.ts` 是手工维护的 8 条别名／id 表（含 `fable`、`claude-fable-5`），无法探测；需随 CrewStation 的模型策略维护。
14. **OpenCode prompt 上限**：prompt 走 argv，硬上限 120 KiB（Linux `MAX_ARG_STRLEN`）；CrewStation 业务子任务若传大输入需改走文件或 stdin（OpenCode 是否接受 stdin prompt：unknown from code）。
15. **`Bun.which('bwrap')`／`socat`**：只与 Claude 内置沙箱有关；沙箱关闭后可随 `boundary.ts` 一起删除，但删除意味着 `settings.permissions.deny` 这层唯一能拦 Edit／Write 工具越界的手段也没有了（代码注释：deny 在所有 permission-mode 下生效）。CrewStation 一容器一任务是否还需要它需裁定。
16. **两个 @deprecated 旧上下文**：`SystemAgentSpawnContext`／`BusinessNodeSpawnContext` 与 `spawnCtx.ts` 翻译层是 agent-workflow 未完成的「true merge」债；照抄可保字节等价，但 CrewStation 没有对拍需求，可在复制后第一步就合并为单一 `AgentSpawnContext` 装配。
