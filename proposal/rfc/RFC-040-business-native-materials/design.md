# RFC-040 技术设计

状态：Done（2026-10-18）；2026-10-15 用户授权接手，按以下合同实现。

## 1. 合同与发布授权

在 `packages/contracts/api/business/materials.ts` 增加可选 `nativeConfig`：

```ts
interface BusinessNativeConfigV1 {
  version: 1
  protocol: 'opencode' | 'claude-code'
  agent: { name: string; body: string; options: Record<string, unknown> }
  subagents: Array<{ name: string; body: string; options: Record<string, unknown> }>
  mcp: Array<
    | { name: string; type: 'remote'; url: string; headers?: Record<string, string>; timeoutMs?: number }
    | { name: string; type: 'local'; command: string[]; env?: Record<string, string>; timeoutMs?: number }
  >
  plugins: Array<{ name: string; entry: string; files: Array<{ path: string; kind: "file"; mode?: number; content?: string; object?: { objectId: string; sha256: string; size: number } } | { path: string; kind: "symlink"; target: string }>; options?: Record<string, unknown> }>
}
```

这些是业务配置材料，不是平台配置根对象。Agent options 使用协议能力白名单：提示／描述／模式、工具与权限、模型选项；禁止 model、provider、baseURL、apiKey、binary、launch、env、配置根路径和平台保留 Agent／MCP／插件名称。对两种协议分别校验选项；未知键失败并报告字段路径。禁止原型键。根 Agent 和 subagents 名称唯一。插件 entry 必须引用本包文件；不接受外部路径或 URL。

Manifest `businessConfig.nativeConfig` 可选：`agentDefinitions`、`inlineRemoteMcp`、`inlineLocalMcp`、`plugins` 四项默认 false。受理时按父任务冻结的发布契约授权，不用当前最新发布。原有 `allowSkills` 和 `allowSystemPromptAppend` 仍只控制原有字段。业务 Agent 能力添加可选 `nativeConfigVersion: 1`；无该能力位时新材料拒绝，旧 Runner 不被误判为支持。

材料 JSON 信封继续限制 1 MiB；技能和插件文件新增互斥的 `content` / `object` 形态，`object = { objectId, sha256, size }` 使用现有对象 ID、摘要和大小 schema。文件树总字节与文件数由发布的材料预算和对象套餐共同限制；对象字节不计入 JSON 信封上限。内联内容保留旧配额，所有文件先完整校验再物化。Agent 正文和选项仍为 JSON，超限明确失败。

插件材料保留完整安装树（包括提升到共同 node_modules 的依赖）、相对 entry 和文件 mode（仅 0000～0777，禁止 setuid/setgid）。符号链接以独立记录保留，只允许相对目标且解析后的完整链仍位于本次插件树内；拒绝循环、悬空链接、链接或普通文件作为其他输出的祖先、重复目标和路径别名。先校验完整树、写普通文件并核对摘要，再创建链接；不能借依赖链接访问其他插件、/work 或宿主。目录由文件树派生，插件目录 entry 允许引用有内容的目录。大型树的 envelope 超限必须在受理前明确失败；不能静默丢弃依赖或链接。

对象必须属于调用服务可访问的对象空间，处于 ready 且摘要／大小匹配。材料受理先为每个对象建立 `material-version` 固定引用，再发布材料版本；幂等恢复沿同一 requestKey 和材料 ID 续办。未完成固定引用的材料不得用于执行。孤立引用保留可恢复记录，不能靠未提交数据库事务中的网络调用假装原子性。受理、计划冻结和文件下载三处均检查摘要；对象版本不可由重试换成最新版。

Runner 命令只带对象的不可变描述和有期限、限定对象的下载授权；通过平台现有对象传输端口取流、按字节预算落盘、重算 sha256 后原子放入该次私有目录。跨 Runner 恢复重新签发下载授权，材料摘要不含 URL／过期时间；不缓存过期 URL 到业务材料。文件不借用父任务 inputObjects 的 archive-and-delete 策略，也不扩大 Agent 对整个对象空间的访问权。对象删除和材料清理必须先证明无尝试仍使用；在证明前保留引用。

### 1.1 命令凭据与私有 Git

`SubmitBusinessSubtaskV3Schema` 的 command.env 采用与 Agent 材料相同的 `BusinessEnvironmentValueSchema`（字面值或 `{ secret: { configDefinitionId } }`）。旧字符串请求保持原语义。新增可选 `tasks.commandBusinessConfig`，以 `allowedEnvNames` 限定业务可注入键；Secret 引用必须属于相同项目且可由该业务服务使用，禁止平台保留键、非法变量名和 NUL。受理时按父任务冻结发布合同授权并冻结 Secret 版本；dispatch 只按已冻结版本渲染，不在重试时读取当前值。

命令载荷摘要覆盖 Secret 引用及冻结版本标识，持久计划只保存引用／版本或现有密文，不保存明文；Runner 受限 RPC 才携带渲染值，平台日志和业务事件不回显。命令 Runner 新增对应能力位，旧 Runner 不接收带 Secret 的命令。新命令使用现有 executionId／attempt／incarnation 对账；不改变取消和未知执行的保留规则。

AW 私有 Git 使用任务镜像内固定凭据助手读取以上环境值；URL／argv／requestKey 中不放 token 或私钥。HTTPS 与 SSH 分别声明所需键，主机密钥验证沿既有 Git 策略，不能用关闭验证作为适配。此项是 RFC-370 私有远程仓库能力的必要配套，并非只支持公开 URL。

## 2. 所有者、数据流与持久化

已读 `docs/engineering/repository-structure.md`，不新增模块或跨模块内部 import。

| 位置 | 职责 |
| --- | --- |
| `packages/contracts` | 材料、Manifest、能力、Runner 命令 schema 与请求摘要 |
| `modules/business-task/domain/businessMaterials.ts` | 冻结发布授权、能力与名称冲突验证 |
| `modules/business-task/application/execution/materials.ts` | requestKey 幂等、不可变材料、对象引用固定与可恢复发布 |
| business-task 的命令受理／dispatch 与 Secret 端口 | 命令发布授权、冻结 Secret 版本、受限 RPC 渲染与脱敏 |
| object-storage 公开对象／引用／传输端口 | 可访问性、固定引用和限定对象下载授权；不跨模块直读存储 |
| `modules/business-task/application/execution/agentMaterial.ts`、Agent plan | 固定材料和算力修订，传递经验证的逐次尝试材料 |
| `runtimes/task/src/agents` | 传递材料、接收能力、生命周期清理；不实现业务授权 |
| `packages/agent-drivers` | 协议编译、私有运行目录物化、路径约束、原生 CLI 启动 |

流程：受理材料 → 冻结摘要 → Agent 子任务绑定材料 → 验证协议与能力 → Runner 接收固定材料 → 在该次 runDir 写配置 → 最后叠加平台保留配置 → 启动 CLI。摘要覆盖全部 nativeConfig；已受理尝试不能受后续发布／配置更新影响。HTTP 重发与 Runner 重连沿用原 executionId/attempt，不再次创建原生进程。

MCP headers 和 env 可承载业务秘密，遵循现有业务材料访问边界，不写日志、错误回显或事件；平台密钥仍通过现有固定版本 Secret 流水线提供。错误只含键名和原因，禁止返回完整配置内容。业务方若需要平台 Secret，继续走原有 Secret 引用，不能通过 nativeConfig 读取平台凭据。

## 3. 协议实现与隔离

OpenCode：扩展现有 inlineConfig／managedConfig 编译，根 Agent 入口与业务名称对应，子代理定义进入 agent 表，MCP 经既有注入分拣，插件文件放入本次私有目录；平台观测插件和模型配置最后合并且不可覆盖。

Claude Code：复用 settings、agents、MCP 与插件的原生入口，权限映射沿用既有工具门；协议不支持的 OpenCode 专有选项明确拒绝。运行时内部子代理仍是 opaqueInternalDelegation，不生成独立 CS 子任务。

只写 runDir 内新文件。相对路径拒绝绝对路径、空段、点段、反斜杠、NUL、重复目标、符号链接逃逸；检查 UTF-8 字节配额。配置先完整校验再物化，再启动进程。取消、初始化失败和恢复沿用现有托管进程确认退出后清理的规则。禁止改共享 /work 的全局 CLI 配置，避免并行 Agent 串扰。

### 3.1 启动清单观测

现有 `packages/agent-drivers/contract/normalizedEvent.ts` 与 Claude `events.ts` 明确没有复制 AW 的 `startup_inventory` 和 init 清单投影。仅增加原生材料仍无法满足 AW MCP 测试台的严格验证。新增可选能力 `startupInventoryVersion: 1` 和业务事件 `startup-inventory`，使用现有 taskId／subtaskId／attempt／cursor 身份，不建立第二条事件传输。

事件数据为版本 1 的判别联合：`{ version: 1, state: 'verified', source: 'claude-init' | 'opencode-inventory', mcpServers: [{ name, status: 'connected' | 'failed' | 'disabled' | 'unknown' }], agents?: string[], skills?: string[], tools?: string[] }`；或 `{ version: 1, state: 'unavailable' | 'malformed', reason: <稳定原因码> }`。仅报告运行时实际返回的字段，未观测的可选维度保持缺省；禁止把声明清单、退出码为 0、Agent 自述或配置文件存在当作观测成功。不可报告原始 headers、env、配置正文、鉴权错误原文或文件路径；错误用稳定码，无 secret hint。

Claude 从该次根会话 init 读取实际清单；OpenCode 在该次私有运行目录使用平台保留的观测设施，结果来自运行时，不扫描共享目录、不读取其他尝试的文件。取消、启动失败、文件未生成／损坏分别输出 unavailable／malformed 原因。根会话初始身份与观测属于同一次 execution/attempt；内部子代理仍保持 opaque，不从 Agent 名单捏造独立执行。

观测与其他业务事件共用持久 outbox、游标重放和最终 result 边界；必须在 result.finalCursor 所覆盖的尾流内完成。清单超过事件字节预算时输出 `unavailable: inventory-too-large`，不得裁剪后标 verified。旧 Runner 缺能力位时仍执行旧合同，不声称完成严格诊断；需要该观测的业务尝试在派发前明确拒绝。合同、协议驱动、Runner 与 business-task 转换各补真实字段投影、重复重放、次序、越界和秘密脱敏用例。

## 4. 故障、兼容与测试

- 未授权、能力缺失、协议不匹配、未知或保留键：启动前具名 `invalid_configuration`／`unsupported_capability`。
- 材料摘要不匹配、同 requestKey 不同内容：现有冲突语义；不能覆盖旧材料。
- MCP 名称与平台连接冲突、插件企图替换平台 Hook：拒绝整份材料。
- 目录／文件异常：无 CLI 进程、原始失败可观测、无部分配置被其他尝试消费。
- 秘密字段只在受限命令传输和运行目录出现，测试断言日志与事件不泄漏。
- 对象未 ready／跨服务／摘要或大小不符／下载过期／途中断线／超预算／取消：不启动 CLI；固定引用与同一材料受理可恢复。
- Secret 版本轮换后重试仍用原版本；原版本不可用则具名拒绝。旧 Runner／未授权键／跨项目 Secret 均在派发前拒绝，不把密钥塞进 argv。

按 `docs/engineering/testing.md`：schema 正反例、领域授权矩阵、双协议真实 argv/env/配置文件断言、FakeProcessHost 失败与取消、模块持久 requestKey/摘要/重连测试、旧材料回归；发布后 CLI 实机验收遵循用户最新裁定：2026-10-15 明确只验证 OpenCode，Claude Code 不作为本轮实机收口条件。每个拒绝分支都有测试。完整实现和测试编写结束后集中执行检查；精确 SHA CI 与本机部署证据分别记录。


### OpenCode 联合接线补充（2026-10-15）

按已批准的原生 MCP／插件与 AW RFC-370 能力等价范围，对照 [OpenCode 1.18.29 的插件合同](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/core/src/v1/config/plugin.ts)，非空插件 options 经 `[fileURL, options]` 传入；MCP remote 的 `oauth=false` 或显式 clientId／clientSecret／scope／redirectUri 原样传入 OpenCode。OAuth clientSecret 与插件 options 的全部非空字符串叶子纳入持久事件脱敏。Claude 不增加这些能力，本轮不做其 CLI 实测。

MCP 子进程 env 名称兼容 POSIX 大小写（与 AW 的既有声明一致），保留 128 字符限制、平台保留名及 loader 命名空间拒绝；命令／根 Agent 的环境变量合同不变。正则由大写集合扩展为大小写集合，所有原来有效的输入保持有效。合同工具将任何 pattern 差异机械归为 breaking，本项是接受集合的兼容扩展，锁文件更新以此处为依据，不要求既有业务迁移。

联合接线中原生 Agent／MCP／插件名称上限从 80 扩展到 128，与 AW 已有资源名称合同一致；正则、平台保留空间与原型键拒绝不变。此项只扩展接受集合，不改变已保存材料的名字或摘要；CS 子任务展示名仍为 80。本轮补充只验证 OpenCode。

## 5. 2026-10-16 审查修复（AW RFC-370 §9.2 跟进）

作者授权按审查结论重设计不合理部分。以下合同变化均随用例落地；集中验证结果记录在本轮交接中，未据此宣称 Done。

### 5.1 对象固定引用的释放与复活

- `business_task.execution_materials` 增加 `releasing`／`released` 两态及 `pin_revision`、`object_count`、`pinned_at`（新迁移 `0039_material_pin_release.sql`）。旧行不改写：`object_count` 为 NULL 表示迁移前受理，首次清扫解密一次后补记；`pinned_at` 为空时回退 `created_at`。
- 可释放条件：父任务已 closed；或固定时间早于 `MATERIAL_PIN_RETENTION_DAYS`（= `BUSINESS_EXECUTION_LIMITS.retentionDays`，7 天），且不存在引用该材料摘要的未终态尝试或保留期内结束的尝试。
- 释放分两段：业务库事务内 `ready／preparing → releasing`；事务外调用 data 的 `release`（按 pin revision 幂等，对象存储冻结时等待，已不存在的对象跳过，释放墓碑同时阻止同 revision 迟到的 pin）；最后 `releasing → released`。中断停在 `releasing`，下一轮清扫或复活时重复。
- 同一 requestKey 再次受理已释放材料即复活：先完成未完成的释放，再 `released → preparing`、`pin_revision + 1` 重新固定同一批不可变对象，材料 ID 与摘要不变。
- 尝试受理（计划、续接、重试）与 `beginRelease` 共用服务锁：已释放材料不能产生新尝试（`material_released`）。data `check` 接受任一 active revision；全部释放时返回 `material_objects_released`，dispatch 把它与 `material_objects_unpinned` 作为终态拒绝。
- `size_bytes` 上限调整为 5 MiB（1 MiB 内联信封 + 4 MiB 对象文件描述，见 5.5）。

### 5.2 原生能力探针 v2

- 仅 OpenCode 执行原生探针。`nativeConfig` 探针同时覆盖：根 Agent 经 `task` 委派给内部子代理，子代理调用插件工具 `business_proof_token`；内联 remote MCP（`oauth: false`）与本地 stdio MCP（`localMcpProbeCommand`）。指令放在 `initialPrompt`，原生正文为空，避免探针依赖 systemPrompt。
- 模型映射探针要求 Runner 声明 `nativeModelMaterialVersion: 1`（见 5.4）。
- 探针结果写入 `nativeProbeVersion: 2`。`testedAgentCapabilities` 只在 `nativeProbeVersion === 2` 且协议为 opencode 时授予 `nativeConfigVersion`／`nativeModelMappingVersion`；旧证明保留其余能力，原生能力需重新测试档位后才恢复（能力影响见 proposal）。

### 5.3 原生正文要求 systemPrompt 能力

OpenCode 的原生 Agent 正文与 systemPrompt 走同一个 prompt 字段。根 Agent 或任一子代理正文非空时，档位必须已通过 systemPrompt 探针，否则启动前报 `unsupported_capability: systemPrompt`；正文为空不受影响。

### 5.4 单一 provider 渲染器

- `PlatformOpencodeModels` 升为 version 2：`providers[alias] = { provider: OpencodeProvider, secrets }`，承载结构化 provider 材料而不是预渲染配置。
- `packages/agent-drivers/drivers/opencode/modelConfig.ts` 的 `renderOpencodeProvider` 是唯一渲染器，独立 Agent 与内部子代理两条路径共用；business-task 只固定和转发（`agentMaterial.ts` 吸收 `pinOpencodeModels`，删除 `application/model-mapping/`）。
- Runner hello 增加 `nativeModelMaterialVersion: 1` 并不再宣称 `nativeModelMappingVersion`；session 协商对 `platformOpencodeModels` 要求该能力位。Runner 脱敏覆盖 provider secrets 及 options 的字符串叶子。

### 5.5 对象文件描述预算

`BUSINESS_NATIVE_MATERIAL_LIMITS.descriptorBytes = 4 MiB`。`businessMaterialAccounting` 把引用对象的文件条目（技能与插件文件）计入描述预算，其余计入 1 MiB 内联信封；schema 与 HTTP 受理使用同一计算。材料请求体上限为 1 MiB + 4 MiB + 64 KiB，其余执行请求仍为 2 MiB。能力 DTO 的 `nativeMaterialLimits.descriptorBytes` 为可选新增字段。

### 5.6 目录规模（工程规则 §11）

超过规模阈值的模块不再新增更深子目录，本轮把被触及的小子目录并回既有文件：`application/execution/command/material.ts` → `commandDispatch.ts`；`ports/materials/objects.ts` → `ports/executionMaterials.ts`；data `ports/objects/materials.ts` → `ports/objectContent.ts`；data 数据库世代的端口／适配器／应用分别并入 `ports/repositories.ts`、`adapters/persistence/databaseGenerations.ts`、`application/serviceData.ts`；release `adapters/persistence/database/restores.ts` → `adapters/persistence/databaseRestores.ts`。release `application/database-restore/` 暂保留：`release/application` 已有 19 个文件，并入 6 个文件会超出每目录 20 个文件的上限，记为剩余结构债。
