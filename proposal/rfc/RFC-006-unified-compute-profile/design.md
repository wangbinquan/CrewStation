# RFC-006｜设计

> Draft · 2026-09-18 待作者批准。与 [proposal.md](proposal.md)、[plan.md](plan.md)、[ADR-0005](../../../docs/adr/0005-compute-profile-in-agent-runtime.md)（提议）一起审。§11 是对结构文档的变化，§13 是实施前必须实测的技术点。

## 1. 现状与断点

| 环节 | 现状（源码） | 改成 |
|---|---|---|
| 档位对象 | `modules/project` 的 `ComputeProfile`：`driver`／`model`／`taskProfile`／可选的 `runtimeConfigId`（[plans.ts:18](../../../modules/project/domain/plans.ts#L18)） | 移到 `modules/agent-runtime`，扩成完整执行配置（§3） |
| 运行环境对象 | `modules/agent-runtime` 的运行环境、不可变版本、草稿／启用、检查（[runtimeConfig.ts](../../../modules/agent-runtime/domain/runtimeConfig.ts)、[activation.ts](../../../modules/agent-runtime/application/activation.ts)、[checks.ts](../../../modules/agent-runtime/application/checks.ts)） | 删除；启动前步骤、凭据、测试记录并入档位 |
| 档位解析 | `computeCatalogFor` 按名称取 driver／model，绑定时再取运行环境材料（[wiring.ts:181](../../../modules/platform/wiring.ts#L181)） | agent-runtime 一次解析出档位修订快照（§4.3） |
| 驱动选二进制 | `defaultDrivers()` 不传 `binaryPath`（[registry.ts:15](../../../runtimes/task/src/agents/registry.ts#L15)）；`prepareNativeTerminal` 不传 `head`（[nativeSupervisor.ts:117](../../../runtimes/task/src/terminal/nativeSupervisor.ts#L117)） | `startAgent`／`startAgentTerminal` 携带 `launch`，驱动按它组装 argv（§4.2） |
| 旧环境文件 | `CS_AGENT_ENV_SECRET`（[platformSettings.ts:63](../../../packages/settings/platformSettings.ts#L63)）→ Pod 挂 `agent-env`（[taskObjects.ts:43](../../../modules/task-runtime/adapters/k8s/taskObjects.ts#L43)）→ Runner 读一次（[runner.ts:87](../../../runtimes/task/src/runner.ts#L87)） | 删除（B1） |
| stub | 契约枚举（[manifest/tasks.ts:4](../../../packages/contracts/manifest/tasks.ts#L4)）、Runner 内置驱动（[stubDriver.ts](../../../runtimes/task/src/agents/stubDriver.ts)）、原生 CLI 拒绝 stub（[nativeTerminalAccess.ts:17](../../../modules/dev-session/application/nativeTerminalAccess.ts#L17)）、模板（[crewstation.yaml:40](../../../templates/minimal-sample/crewstation.yaml#L40)）、播种（[seed-catalog.sh:48](../../../deploy/local/seed-catalog.sh#L48)） | 删除（B4、B5） |
| 默认档位 | `CS_DEFAULT_COMPUTE_PROFILE`（[platformSettings.ts:13](../../../packages/settings/platformSettings.ts#L13)）；省略 `compute` 时 dev-session 用它（[agents.ts:25](../../../modules/dev-session/application/agents.ts#L25)、[nativeTerminalAccess.ts:14](../../../modules/dev-session/application/nativeTerminalAccess.ts#L14)） | 库内默认标记；`default` 在每次启动时解析（C13、C17） |
| Agent 执行位置 | 「＋ CLI」：独立 Pod，镜像取 `settings.taskImage`（[nativeExecution.ts:45](../../../modules/task-runtime/application/nativeExecution.ts#L45)）；headless 与业务子任务：向父任务的 Runner 发 `startAgent`（[agents.ts:45](../../../modules/dev-session/application/agents.ts#L45)、[subtaskLaunch.ts:55](../../../modules/business-task/application/subtaskLaunch.ts#L55)） | 四种用途统一建执行环境，镜像取档位修订的摘要（§5） |
| Pod 主容器命令 | 未指定，用镜像自带的 ENTRYPOINT／CMD（[taskObjects.ts:34](../../../modules/task-runtime/adapters/k8s/taskObjects.ts#L34)） | 显式指定 Runner 启动命令（§7.3） |
| Runner 协议 | `TASKRUNNER_PROTOCOL_VERSION = 1`，hello 用字面量校验（[protocol.ts:13](../../../packages/contracts/taskrunner/protocol.ts#L13)、[protocol.ts:24](../../../packages/contracts/taskrunner/protocol.ts#L24)）；`capabilities.drivers` 按 PATH 上找得到的二进制上报 | 协议 2；hello 报 Runner 代码理解的协议（§4.2） |
| 测试 | 检查只针对运行环境版本；镜像固定 `settings.taskImage`，版本探测写死二进制名（[runtimeCheck.ts:25](../../../modules/task-runtime/application/runtimeCheck.ts#L25)、[runtimeCheck.ts:63](../../../modules/task-runtime/application/runtimeCheck.ts#L63)） | 按档位修订测试；镜像取修订摘要；已知协议做 nonce 判定与失败分类，通用终端做命令匹配（§6） |
| 平台仓库 | 本机是集群内无认证的 `registry:3.1.1`（[bootstrap.sh:69](../../../deploy/local/bootstrap.sh#L69)），BuildKit 以 insecure 方式推送；任务镜像 `cs-task-runtime:dev` 直接载入节点，不在仓库里（[10-config.yaml:16](../../../deploy/k8s/platform/10-config.yaml#L16)） | 底座推入仓库固定路径；管理员推送用平台签发的临时凭据（§7） |
| Agent 的 HOME | 旧模式 HOME＝`/work`（[Dockerfile](../../../runtimes/task/Dockerfile) 注释）；RFC-004 托管 Agent 用 tmpdir 下的私有目录，进程结束即删（[beforeStartRunner.ts:51](../../../runtimes/task/src/beforeStart/beforeStartRunner.ts#L51)） | 每个 Agent Pod 私有 HOME（P6） |

## 2. 落位与依赖

| 模块／包 | 层 | 改什么 |
|---|---|---|
| `packages/contracts` | — | `AgentProtocolSchema` 取代 `AgentDriverSchema` 与 `RuntimeDriverSchema`（删 `stub`，加 `terminal`）；`LaunchSpec`；档位管理 DTO、租户投影、测试记录 DTO；Runner 协议 2（`launch`、`profileRevision`、`beforeStart`、`probeTerminal`、`capabilities.protocols`）；删除运行环境接口契约 `api/agentRuntime/runtimeConfig.ts` |
| `modules/agent-runtime` | L3 | 成为算力档位唯一宿主：档位、不可变修订、凭据、测试记录、默认、启用、删除与引用确认、解析服务、管理员与租户路由；运行环境对象删除 |
| `modules/project` | L2 | 删除 `ComputeProfile` 的表、用例、路由、端口与 `RuntimeConfigDirectory` 端口；保留 ServicePlan／TaskProfile／TaskQuota |
| `modules/task-runtime` | L4 | 执行环境从「＋ CLI 专用」推广为四种用途；镜像取档位摘要；Pod 显式 Runner 命令；握手失败原因回写；测试执行器改写 |
| `modules/dev-session` | L5 | headless Agent 先建执行环境再派发；消息与取消按执行环境路由；通用终端档位只进「＋ CLI」；`default` 在启动时解析 |
| `modules/business-task` | L5 | Agent 子任务先建执行环境（占额度）再派发；交互子任务的消息路由；暂停时结束执行环境；命令子任务不变 |
| `modules/session` | L5 | hello 协议不一致时把拒绝原因交给 task-runtime（经已有的 `onRunnerDisconnected` 一类回调扩展） |
| `modules/release` | L4 | Manifest `compute` 校验改由 agent-runtime 提供：不存在、通用终端、`default` 而无默认档位三种拒绝 |
| `modules/capabilities` | L6 | 档位列表来源改为 agent-runtime 的租户投影 |
| `modules/identity`／cs-auth | L1 | 平台仓库推送凭据的签发与校验端点（§7.2） |
| `modules/platform` | L7 | 装配 agent-runtime 的三个端口（TaskProfile 目录→project、发布引用查询→release、测试执行→task-runtime）；删除 `computeCatalogFor` 里的双对象拼接 |
| `runtimes/task` | — | 删 stub 驱动与 `agentEnvFile`；驱动按 `launch` 取二进制与参数；通用终端协议的 PTY 启动；`probeTerminal`；Runner 协议 2；Dockerfile 暴露稳定启动路径 |
| `packages/agent-drivers` | — | 接通 `binaryPath`；配置目录变量名与目录名覆盖；`extraArgs` 及保留参数校验；`IS_SANDBOX`；opencode 参数；通用终端的 argv 组装 |
| `packages/settings` | — | 删 `agentEnvSecretName`、`defaultComputeProfile`；加底座镜像引用与仓库推送主机名 |
| `apps/console` | — | 管理页一张档位表与档位编辑器（复用 RFC-004 的步骤、变量组件）、测试时间线、推送信息卡；租户两个下拉的过滤 |
| `apps/cli`、`deploy/local` | — | 不再播种档位；安装时把底座镜像推入平台仓库；网关新增仓库主机 |
| `templates/minimal-sample` | — | `compute: default` |

依赖方向不新增模块间的边。agent-runtime 继续不 import 其他模块，所需的三件事经端口由 platform 回填（ADR-0005）。release、dev-session、business-task、capabilities 经各自已有的端口取档位，platform 把端口实现从 project 改接到 agent-runtime。

## 3. 数据模型（`agent_runtime` schema，断代重建）

| 表 | 列 | 说明 |
|---|---|---|
| `profiles` | `name` 主键、`protocol`、`description`、`enabled`、`is_default`（部分唯一索引）、`current_revision`、`created_by`／`created_at`、`updated_by`／`updated_at` | 身份与开关；说明、启用、默认不进修订（P3） |
| `profile_revisions` | `name`、`revision`、`content`（jsonb）、`content_hash`、`image_digest`、`created_by`／`created_at` | 只追加；`content` 含镜像引用、二进制、附加参数、配置目录、`IS_SANDBOX`、模型与 opencode 参数、资源套餐名、启动前步骤、变量、测试命令 |
| `profile_credentials` | `name`、`revision`、`key`、`sealed`（SecretBox） | 随修订复制；写请求 keep／replace／clear（沿用 RFC-004）；GET 只回「已设置」 |
| `profile_tests` | `test_id`、`name`、`revision`、`content_hash`、`trigger`（save／manual）、`client_request_id`、`state`、`outcome`、`stages`、`context`、`error`、时间戳 | 同一修订最新一条决定可用性；产生新修订时，旧修订未结束的测试置为 `superseded` |

可用性（租户投影的 `available`）＝ `enabled` 且当前修订有一条 `state=passed`、`content_hash` 相同的测试。不可用原因按顺序取：已停用；测试中；测试失败（附阶段）；尚未测试。

删除：`project.compute_profiles` 与 `agent_runtime.configs`／`revisions`／`credentials`／`checks` 直接 drop（C8 断代，不迁移）。

并发写：保存携带 `expectedRevision`，不一致返回 409 并保留表单（沿用 RFC-004 的 CAS）。

## 4. 契约

### 4.1 管理面与租户面 API

| 接口 | 语义 |
|---|---|
| `GET /v1/admin/compute-profiles` | 列表：名称、协议、镜像引用与摘要短码、模型、启用、默认、当前修订、最近测试、被引用项目数 |
| `POST /v1/admin/compute-profiles` | 新建（修订 1），202 附自动测试的 `testId` |
| `GET /v1/admin/compute-profiles/:name` | 详情：当前修订内容（凭据只回是否已设置）、最近测试 |
| `PUT /v1/admin/compute-profiles/:name` | 保存：`expectedRevision` CAS；执行相关字段变化才生成新修订并自动测试，只改说明不生成（P3） |
| `PUT /v1/admin/compute-profiles/:name/enabled` | 启用／停用；默认档位不能停用（409 `default_profile_locked`） |
| `PUT /v1/admin/compute-profiles/:name/default` | 设为默认；未启用或协议为通用终端时 409 |
| `DELETE /v1/admin/compute-profiles/:name` | 默认档位 409；被引用且未带 `confirmReferences=true` 时 409 附项目清单（C19、P8） |
| `POST /v1/admin/compute-profiles/:name/copy` | 复制为新名称（P5） |
| `POST /v1/admin/compute-profiles/:name/tests` | 手动重测当前修订；`clientRequestId` 幂等 |
| `GET /v1/admin/compute-profiles/:name/tests/:testId` | 测试进度与逐阶段结果；断线后按 ID 恢复 |
| `GET /v1/admin/runtime-images` | 推送信息：推送主机、仓库前缀、底座镜像引用与摘要、示例 Dockerfile |
| `POST /v1/admin/runtime-images/credentials` | 签发推送凭据：用户名、口令、到期时间、可推送前缀（C18、§7.2） |
| `GET /v1/catalog/compute-profiles` | 租户投影：`name`、`description`、`terminalOnly`、`isDefault`、`available`、`reason`；不含镜像、二进制、模型 |

全部管理接口只对管理员开放，服务端逐个裁定。

### 4.2 TaskRunner 协议 2

- `TASKRUNNER_PROTOCOL_VERSION` 从 1 升到 2。hello 仍按字面量校验：旧底座镜像里的 Runner 在握手时即被拒绝（C20、B12），拒绝原因回写到对应的执行环境（§5.3）。
- hello 的 `capabilities.drivers`（按 PATH 上的二进制上报）改为 `capabilities.protocols`，即 Runner 代码理解的协议。二进制在不在、能不能起，由测试作业证明，不再由 hello 声称。
- `startAgent`（只允许 `claude-code`／`opencode`）与 `startAgentTerminal`（三种协议都允许）用 `launch` 取代 `driver`／`model`：

```ts
export const AgentProtocolSchema = z.enum(['claude-code', 'opencode', 'terminal']);

export const LaunchSpecSchema = z.object({
  protocol: AgentProtocolSchema,
  binaryPath: z.string().startsWith('/'),
  extraArgs: z.array(z.string().min(1)).max(16).default([]),
  configDir: z.object({ env: EnvNameSchema.optional(), name: z.string().min(1).optional() }).optional(),
  isSandbox: z.boolean().default(false),
  model: z.string().min(1).optional(),
  opencode: z.object({ variant: z.string(), temperature: z.number().min(0).max(2), steps: z.number().int().positive(), maxSteps: z.number().int().positive() }).partial().optional(),
});
```

  按协议的字段适用矩阵（proposal.md §5.1）在 `superRefine` 里校验。`compute`（档位名）照旧透传回显，另加 `profileRevision`；RFC-004 的启动前材料字段 `runtime` 保留语义，改名 `beforeStart`。
- 新增 `probeTerminal` 命令：执行启动前步骤后运行测试命令，返回退出码与有界的输出尾部（§6.2）。
- 通用终端的 `startAgentTerminal`：argv 为 `[binaryPath, ...extraArgs]`，在 PTY 中启动；不装 Claude hooks 和 OpenCode 插件，不产生原生动态事件；进程环境加入 `CS_MCP_CAPABILITIES_URL`、`CS_MCP_OPERATIONS_URL`、`CS_MCP_TOKEN`（C16）。
- 启动前步骤的模板上下文加 `{{mcp.capabilitiesUrl}}`、`{{mcp.operationsUrl}}`、`{{mcp.token}}`，三种协议都可用（C16）。令牌仍是会话级短期令牌，长命进程的续期沿用 `implementation-open-questions.md` I3 的现状，本 RFC 不解决。

### 4.3 解析与快照

`agentRuntime.resolve(nameOrDefault, usage)` 返回 `ResolvedProfile { name, revision, protocol, launch, image: ref@digest, resources, beforeStart }`：

- `default` 在每次调用时解析到当前的默认档位（C17）；没有默认档位时报 `precondition no_default_profile`。
- `usage` 取 `cli`／`agent`／`subtask`；通用终端档位用于后两者时报 `validation terminal_profile_not_allowed`。
- 档位不可用（停用、未测试、测试中、测试失败）时报 `precondition profile_unavailable`，附原因。
- 受理时把 `{name, revision}` 固定进启动记录，之后派发只按固定修订取材料，与 RFC-004 的快照语义相同。

### 4.4 Manifest

`agentProfiles[].compute` 接受档位名或 `default`。发布校验（[pipelineDeploy.ts:20](../../../modules/release/application/pipelineDeploy.ts#L20) 一带）有三种拒绝：档位不存在（列出可用名）；引用了通用终端档位；写了 `default` 而没有默认档位。校验只看存在性与协议，不看测试状态：能不能用，在起 Agent 时判定。

## 5. 执行模型：每个 Agent 一个执行环境

### 5.1 执行环境对象

把 `NativeExecution`（[taskEnvironment.ts:7](../../../modules/task-runtime/domain/taskEnvironment.ts#L7)）推广为 `AgentExecution`：

| 字段 | 说明 |
|---|---|
| `purpose` | `cli`（「＋ CLI」）／`agent`（headless）／`subtask`（业务 Agent 子任务）／`profile-test` |
| `parentTaskId` | 开发会话或业务任务；`profile-test` 挂平台检查任务 |
| `profile` | `{ name, revision }`，以及冻结的 `image`（引用＋摘要）与 `resources` |
| 其余 | 沿用：`parentPodUid`、`pvcUid`、`nodeName`、`agentId`、`terminalId`（仅 `cli`）、`runnerId`、状态机 `queued → starting → running → cleaning → finished`、`failureReason` |

`TaskKind` 不增加取值：执行环境仍挂在父任务的 kind 下，用 `parentTaskId` 与 `purpose` 区分，沿用 `cli-isolation.md` 的做法。`runtime-check` 这个 kind 改名为 `profile-test`。

### 5.2 准入与创建

在同一个项目锁内：父任务必须处于 running 且已连接 → 取 TaskProfile → `admissions.tryAcquire`（C14）→ 登记执行环境并入队。`profile-test` 用平台哨兵项目，并发上限沿用 RFC-004 的 4。

Pod 规格：`image: <ref>@<digest>`；显式的 Runner 命令与 `runAsUser: 0`（§7.3）；档位的资源套餐；父任务的工作卷（`profile-test` 用 emptyDir 放一个样例目录）；同节点亲和；执行专用的 Runner 令牌 Secret。不再有 `agent-env` 挂载，也没有 checkout init 容器。

### 5.3 派发、路由与回收

- Runner 连上后由对应用例派发：`cli` → `startAgentTerminal`；`agent`／`subtask` → `startAgent`；`profile-test` → §6。
- 之后的 `sendMessage`、`cancelAgent`、终端输入按执行环境的 taskId 路由（session 已按实际 Runner 转发，见 `cli-isolation.md`）；headless Agent 的列表与动态按来源游标汇聚（沿用第七十七批的聚合）。
- hello 被拒（协议版本不一致）、五分钟未连接、镜像拉取失败、容器退出：执行环境置为 failed 并写明原因，释放额度，只影响这一个 Agent。
- Agent 结束 → 保存末屏（`cli`）或终态事件 → 回收 Pod 与额度。父任务释放时先回收全部执行环境（已实现）。业务任务暂停时结束全部执行环境，恢复时不重起（P7）。
- 每个 Agent Pod 用私有 HOME（emptyDir），Pod 结束即清理（P6）。同一 Agent 内的多轮续接在同一个 Pod 里完成，不受影响。

### 5.4 业务 Agent 子任务

`SubtaskRun` 的 Agent 分支从「向任务 Runner 发 `startAgent`」改为「建 `subtask` 执行环境 → 就绪后向子 Runner 发 `startAgent`」。子 Runner 与父容器挂同一个工作卷，输出契约校验在子 Runner 内完成；文件与结果读取仍经父 Runner（R31）。额度不足时子任务 failed，错误写明「项目并发额度已满」，由业务程序自行重试（R43 的语义不变）。命令子任务仍在父容器执行，不占额外额度。

## 6. 测试作业

### 6.1 触发与状态

- 保存产生新修订时，在同一事务里写 outbox，由 `packages/queue` 的工作器执行（沿用 RFC-004 的检查工作器）。手动重测走同一队列。
- 状态为 `queued → running → passed／failed／unknown／superseded`。Runner 或测试环境中途丢失、无法确认结果时记为 `unknown`，不自动重跑（沿用 RFC-004 §5.2）。

### 6.2 阶段

| 阶段 | 判定 |
|---|---|
| 镜像拉取 | Pod 事件 `ErrImagePull`／`ImagePullBackOff` → 失败「镜像拉取失败」 |
| Runner 握手 | 容器启动失败（找不到 Runner 启动路径）→「镜像不是基于平台底座构建」；hello 协议不一致 →「Runner 协议版本 x，平台要求 y」；超时 → 写明调度原因 |
| 启动前步骤 | 逐步（沿用 RFC-004 的执行记录） |
| 协议测试（已知协议） | 以 oneshot 模式发一个要求原样输出随机 nonce 的提示。通过条件：退出码 0、事件可解析、捕获到会话 id、回显了 nonce。失败分类沿用 agent-workflow `runtimeSmoke.ts` 的判定顺序：超时 → 网络 → 鉴权 → 模型 → 不符合协议；分类正则随实现移植，并带上回归用例 |
| 测试命令（通用终端） | `probeTerminal`：退出码 0 且 stdout＋stderr 匹配期望正则；默认 60 秒超时，上限沿用脚本步骤的 10 分钟 |

### 6.3 记录

`context` 记录镜像摘要（Pod status 的 `imageID`）、Runner 协议版本、CLI 版本（已知协议执行 `<binaryPath> --version`，取不到记 null）和解释器清单。`stages[]` 记录各阶段起止时间、退出码和脱敏后的错误尾部（沿用 `maxLogTailChars`）。

## 7. 镜像

### 7.1 平台底座

- 安装与升级时，把任务镜像推入 `<registryBase>/crewstation/task-runtime:<平台版本>`；管理页显示其引用与摘要（`GET /v1/admin/runtime-images`）。
- `runtimes/task/Dockerfile` 增加稳定的 Runner 启动路径 `/opt/crewstation/bin/task-runner`（包一层 `bun run /app/runtimes/task/src/main.ts`），供 Pod 显式调用。
- 示例 Dockerfile：

```dockerfile
FROM <registryBase>/crewstation/task-runtime@sha256:<底座摘要>
COPY my-cli /opt/my-cli/bin/my-cli
# 不要修改 USER、ENTRYPOINT、CMD：平台显式以 root 启动 Runner，Runner 再降权启动 Agent。
```

### 7.2 推送凭据（C18）

本机实现提议如下（§13 列出要实测的点）：

- 网关新增仓库主机 `registry.<userDomain>`，IngressRoute 指向平台仓库 Service，前置 ForwardAuth 到 cs-auth 的仓库鉴权端点。
- cs-auth 签发的推送凭据是「用户名＋带到期时间与前缀的签名口令」。鉴权端点校验签名、到期时间、方法与路径：只放行 `/v2/` 探测与 `/v2/runtime/…` 下的推拉，其余返回 401／403，并按 Docker 客户端的要求带 `WWW-Authenticate: Basic`。
- 集群内拉取不变：kubelet 经节点 containerd 的 hosts.toml 走 NodePort（[node-registry-hosts.sh](../../../deploy/local/node-registry-hosts.sh)），BuildKit 仍直接推 ClusterIP。
- 生产环境的平台仓库如果是公司仓库（Harbor 一类），同一个管理接口改由 `ImageRegistry` 适配器用它的机器人账号签发。本 RFC 只实现本机适配器。

### 7.3 保存校验与 Pod 规格

- 镜像引用必须以 `<registryBase>/runtime/` 开头（C15），否则 400。
- 保存时经仓库 HTTP API `HEAD /v2/<name>/manifests/<tag>` 取 `Docker-Content-Digest` 固定摘要；标签不存在或仓库不可达时返回 400 并说明原因，不生成修订。
- Pod 主容器：`image: <ref>@<digest>`、`command: ["/usr/bin/tini", "--", "/opt/crewstation/bin/task-runner"]`、`securityContext.runAsUser: 0`。这样管理员镜像里的 `USER`、`ENTRYPOINT`、`CMD` 都影响不到 Runner。

## 8. 删除与引用查询

agent-runtime 声明端口 `ProfileReferences.listReferencingProjects(name)`，由 platform 用 release 回填：对每个服务取 preview／prod 两个槽当前部署的 Release，解析其冻结 Manifest 的 `agentProfiles[].compute`，按名称命中就计入；经 `default` 间接引用的不计（P8）。

## 9. 失败模式

| 情形 | 行为 |
|---|---|
| 镜像地址不在平台仓库 | 保存 400，定位到字段 |
| 标签不存在或仓库不可达 | 保存 400，不生成修订 |
| 二进制路径为空或不是绝对路径 | 保存 400 |
| 附加参数含平台保留的参数 | 保存 400，列出冲突参数（按协议的保留表，移植 agent-workflow 的 `validateExtraArgs`） |
| 配置目录变量名非法，或与平台保留变量冲突 | 保存 400（移植 `RESERVED_SPAWN_ENV` 与叶子名校验） |
| 通用终端缺少测试命令，或期望正则非法 | 保存 400 |
| 并发保存 | 409，保留表单并显示当前修订 |
| 保存后测试进行中或失败 | 租户下拉禁选并写原因；已在运行的 Agent 不受影响 |
| 测试中途 Runner 丢失 | 记 `unknown`，不自动重跑，可手动重测 |
| 起 Agent 时档位不可用 | `precondition profile_unavailable`，附原因 |
| 写了 `default` 而没有默认档位 | 起 Agent：`precondition no_default_profile`；发布：校验失败 |
| 通用终端档位用于 headless Agent 或业务子任务 | `validation terminal_profile_not_allowed`；发布校验拒绝 |
| 额度已满 | `quota_exceeded`；本次 Agent 不启动，已有 Agent 不受影响 |
| 用旧底座（协议 1）构建的镜像 | hello 被拒，执行环境 failed：「Runner 协议版本 1，平台要求 2，请基于新底座重建镜像」 |
| 镜像里没有 Runner 启动路径 | 容器启动失败，执行环境 failed：「镜像不是基于平台底座构建」 |
| 删除或停用默认档位 | 409 `default_profile_locked` |
| 删除被引用的档位但未确认 | 409，附项目清单 |
| 推送凭据过期或越权推送路径 | 仓库返回 401／403 |

## 10. 测试策略

必写的用例（开发规则 §4），每条禁用或拒绝分支都要有（§5.5）：

- **contracts**：`LaunchSpec` 各协议的字段适用矩阵（opencode 带 `extraArgs` 被拒、终端带模型被拒等）；`startAgent` 拒绝 `terminal`；Manifest 的 `compute: default` 可以解析、`default` 作为档位名被拒；协议 2 的 hello 拒绝协议 1。
- **agent-runtime**：
  - 修订：保存生成修订与内容哈希；只改说明不生成修订；CAS 冲突；复制档位。
  - 凭据：keep／replace／clear，GET 不含原值。
  - 可用性：四种不可用原因。
  - 默认与删除：默认唯一；默认不能停用或删除；终端协议不能设为默认；删除被引用档位时 409，确认后才删除。
  - 测试触发：保存触发测试；新修订作废旧测试。
  - 保存校验：镜像前缀与摘要解析失败；保留参数与保留变量。
- **task-runtime**：
  - 准入：四种 purpose 的准入与额度（满额拒绝、只释放一次）。
  - Pod 规格：含摘要、显式命令、`runAsUser: 0`，没有 `agent-env`。
  - 失败回写与暂停：hello 协议不一致和容器启动失败的原因回写；业务任务暂停时结束全部执行环境。
  - 测试执行器：各阶段判定（假集群、假 Runner）；nonce 分类正则的回归，含 agent-workflow 记录过的 `503`／`529` 误命中。
- **dev-session**：headless Agent 经执行环境派发；消息与取消路由到子 Runner；通用终端档位只进「＋ CLI」；`default` 在每次启动时解析。
- **business-task**：Agent 子任务占额度；满额时 failed 的错误文案；命令子任务不占额度；交互子任务的消息路由。
- **release**：三种拒绝（不存在、终端协议、无默认档位）。
- **runtimes/task 与 agent-drivers**：`binaryPath`、`extraArgs`、`configDir`、`IS_SANDBOX`、opencode 参数确实进入 argv 与 env；终端协议的 argv 与 `CS_MCP_*` 环境；`probeTerminal` 的超时与输出截断；删除 stub 与 `agentEnvFile` 后的源码层断言。
- **console**：只有一张档位表；按协议显隐字段；测试时间线；默认、停用、删除的确认；租户两个下拉的过滤与禁选原因；没有运行环境页签的源码层断言。

## 11. 与结构文档的对齐与偏离

对齐：档位全部落在 `modules/agent-runtime`（L3），一模块一 schema；跨模块只存名称与 ID；不新增依赖边；console 新组件放 `features/admin/components/compute/` 子目录，复用 RFC-004 的步骤与变量编辑组件。

需作者确认的结构变化（ADR-0005，提议状态）：

1. **`ComputeProfile` 从 `project`（L2）移到 `agent-runtime`（L3）**，后者成为档位唯一宿主，原运行环境对象删除。理由：档位现在带启动前步骤、凭据、修订与测试，正是 ADR-0004 为 agent-runtime 划定的职责；放回 project 会让它从 41 个源码文件继续膨胀。
2. **agent-runtime 继续不 import 其他模块**：TaskProfile 目录、发布引用查询、测试执行三件事经端口，由 platform 回填。
3. **模块名不改**，schema 仍叫 `agent_runtime`：职责仍是「Agent 运行配置」，改名只会带来路径与迁移搬家。

## 12. 基线回填清单（实施完成后）

- Design §1.2：`ComputeProfile` 一行改写为完整执行配置，删除运行环境相关表述。
- Design §10.1：「开发会话与业务任务共用容器镜像」改为「父容器用平台底座，每个 Agent 一个执行环境，镜像由档位决定」。
- Design §10.4：配额计数加上「每个 Agent 执行环境占一个」。
- Design §10.8：单一任务镜像改为「平台底座＋管理员基于底座构建的档位镜像」；模型凭据经平台 Secret 注入的表述改为档位凭据。
- Design §12.4：补上 C20（Runner 协议升级后，旧底座镜像由管理员重建）。
- Proposal R05、R43 的验收说明按 C4、C14 更新；R25「平台协议不绑死某个引擎」补上通用终端协议。
- 结构文档 §5 模块表：`agent-runtime` 一行改为算力档位；`project` 一行确认不含档位。

## 13. 实施前必须实测的技术点

1. Docker 客户端经 Traefik＋ForwardAuth 推送：401 带 `WWW-Authenticate: Basic` 能否触发客户端发送凭据；分块上传经过网关是否完整；主机名解析到 127.0.0.1 时，Docker 是否按 insecure 处理本机 HTTP。
2. kubelet 以 `<registryBase>/runtime/x@sha256:…` 拉取，是否沿用现有的 hosts.toml 通路。
3. 两个官方 CLI 在显式命令加 `runAsUser: 0` 下，Runner 的降权路径（现有 setpriv 链）不变。
4. registry:3 对 `HEAD /v2/<name>/manifests/<tag>` 返回的摘要，与 kubelet 解析出的 `imageID` 是否一致（多架构索引与单清单两种情况都要看）。
