# RFC-006｜算力档位合并运行环境：管理员自带镜像与二进制，每个 Agent 独立 Pod，保存即真实测试

> Done · 2026-09-18 作者设定会话目标「完整实现RFC并提交上库」，本 RFC 据此实施完成（实机验收与基线回填见 plan.md「实施说明」）。产品规则来自作者 2026-09-18 五轮会话裁定（§2）；§13 的 P1–P8 与 ADR-0005 **未经作者逐条确认**，实施先按文中提议做法进行，作者复核时可以改判。RFC-004 按作者裁定 C8 置为 Superseded（§9）。进度与证据见 [plan.md](plan.md) 的实施说明。

## 1. 背景与依据

作者 2026-09-18 提出三个问题：

1. 算力档位和运行环境没有匹配关系，选了一个档位以后，启动的是哪个运行时？
2. 运行环境配置要和 agent-workflow 一样，支持自定义二进制，不能默认就启动 claude、opencode 的二进制；并且要有测试能力：真实启动一个容器，用档位定义的运行时跑一次真实的测试作业。
3. 运行时是不是还要能指定镜像？否则二进制怎么进入镜像？

逐条对照源码，三条都成立：

| 问题 | 现状 | 出处 |
|---|---|---|
| 选档位后启动哪个二进制 | 只由档位的 `driver` 决定：Runner 创建驱动时不传二进制路径，驱动里写死 `claude`／`opencode`；「＋ CLI」的原生路径同样不传 | [plans.ts:18](../../../modules/project/domain/plans.ts#L18)、[registry.ts:15](../../../runtimes/task/src/agents/registry.ts#L15)、[claudeCode/driver.ts:24](../../../packages/agent-drivers/drivers/claudeCode/driver.ts#L24)、[opencode/driver.ts:25](../../../packages/agent-drivers/drivers/opencode/driver.ts#L25)、[nativeSupervisor.ts:117](../../../runtimes/task/src/terminal/nativeSupervisor.ts#L117) |
| 运行环境与档位的关系 | RFC-004 的运行环境只是一包启动前文件／脚本＋变量＋凭据，不决定二进制。档位绑定它是可选的，表单默认选项就是「部署配置模式」，不绑定时读安装配置 `CS_AGENT_ENV_SECRET`。`driver` 在两边各存一份，靠一致性校验兜底 | [ComputeProfileForm.tsx:36](../../../apps/console/src/features/admin/components/ComputeProfileForm.tsx#L36)、[admin zh-CN.ts:167](../../../apps/console/src/features/admin/i18n/zh-CN.ts#L167)、[plans.ts:52](../../../modules/project/domain/plans.ts#L52)、[wiring.ts:189](../../../modules/platform/wiring.ts#L189) |
| 本机实况（2026-09-18 只读查询） | 4 个档位的 `runtime_config_id` 全为空；唯一的运行环境 `kkk`（claude-code）没有启用版本，检查记录 0 条 | `project.compute_profiles`、`agent_runtime.configs`、`agent_runtime.checks` |
| 自定义二进制 | 驱动包保留着从 agent-workflow 复制来的 `binaryPath` 接缝，但运行环境没有这个字段，Runner 也从不传 | [cliRuntimeAdapter.ts:40](../../../packages/agent-drivers/drivers/cliRuntimeAdapter.ts#L40)、[cliDriver.ts:30](../../../runtimes/task/src/agents/cliDriver.ts#L30) |
| 测试 | RFC-004 已有检查代码：在平台命名空间起检查容器、跑启动前步骤、以 oneshot Agent 回显固定标记。但镜像固定是平台任务镜像，版本探测写死两个二进制名；只能检查运行环境的某个版本，并与「检查通过才能启用」绑定；没有按档位测试的入口。本机从未执行过 | [runtimeCheck.ts:25](../../../modules/task-runtime/application/runtimeCheck.ts#L25)、[runtimeCheck.ts:63](../../../modules/task-runtime/application/runtimeCheck.ts#L63)、[checks.ts:38](../../../modules/agent-runtime/application/checks.ts#L38) |
| 镜像 | 平台只有一个任务镜像，两个 CLI 在构建时钉死版本，这正是基线 Design §10.8 的「镜像内含 TaskRunner 与双驱动 CLI，版本一起锁定」；「＋ CLI」的独立 Pod 在准入时冻结的也是它 | [Dockerfile:18](../../../runtimes/task/Dockerfile#L18)、[nativeExecution.ts:45](../../../modules/task-runtime/application/nativeExecution.ts#L45)、[design.md §10.8](../../design.md) |
| Agent 起在哪里 | 「＋ CLI」已是独立 Pod（RFC-003 I15）；headless Agent 在开发会话父容器里、业务子任务在任务容器里再起进程 | [nativeExecution.ts:45](../../../modules/task-runtime/application/nativeExecution.ts#L45)、[agents.ts:45](../../../modules/dev-session/application/agents.ts#L45)、[subtaskLaunch.ts:55](../../../modules/business-task/application/subtaskLaunch.ts#L55) |

借鉴对象是 `~/dev/proj/agent-workflow`（只读，任何情况下不写入）：

- `runtimes` 表每行是一个注册的二进制实例：名称、协议（`opencode`／`claude-code`）、二进制路径（空＝协议默认）、配置目录的环境变量名与目录名、附加 argv、`IS_SANDBOX`、模型及 `variant`／`temperature`／`steps`／`maxSteps`。Agent 按名称引用运行时。
- 「测试」用协议驱动拉起该二进制，发一个带随机 nonce 的提示，要求事件流可解析、拿到会话 id、回显 nonce。失败分为无法启动、缺少鉴权、网络不可达、模型调用失败、不符合协议五类。结果只存回执，不拦保存。它在守护进程所在的本机跑，不起容器。
- 出处：`packages/backend/src/db/schema.ts` 的 `runtimes` 表、`services/runtimeSmoke.ts`、`routes/runtimes.ts`、`frontend/src/components/RuntimeList.tsx`。

## 2. 作者裁定（2026-09-18，五轮问答）

| # | 裁定项 | 结论 |
|---|---|---|
| C1 | 档位与运行时的关系 | **合并成一个对象**：取消独立的「运行环境」，档位本身带协议、二进制、镜像、启动前步骤和模型；管理页只剩一张表 |
| C2 | 谁注册 | **只有管理员**；项目仍只按档位名使用 |
| C3 | 二进制怎么进容器 | **档位指定镜像**，镜像由管理员基于平台底座（`FROM` 平台任务镜像）自行构建；平台按摘要固定，Runner 握手时校验协议版本 |
| C4 | Agent 在哪个容器里跑 | **每个 Agent 独立 Pod**：「＋ CLI」、headless Agent、业务子任务与测试，每次起 Agent 都按档位镜像建一个 Pod，挂同一个工作卷 |
| C5 | 二进制路径 | **必填**，不回落协议默认名；平台底座继续预装两个官方 CLI，管理员可以直接填 `/usr/local/bin/claude` 或 `/usr/local/bin/opencode` |
| C6 | 协议范围 | `claude-code`、`opencode`，**外加一个通用终端协议**：任意 CLI 都能在「＋ CLI」的终端里运行，但平台不解析它的事件与会话，不能用于 headless Agent 与业务子任务 |
| C7 | 测试与生效 | **保存即生效，测试通过前租户侧不可选**；不区分草稿版本和启用版本 |
| C8 | 旧模式 | **断代删除**：去掉部署配置模式与 `CS_AGENT_ENV_SECRET`；本机现有 4 个档位与运行环境 `kkk` 不迁移，由管理员按新对象重建；RFC-004 标为 Superseded |
| C9 | 编辑后的不可用窗口 | 接受；**每次保存自动触发测试**，通过即恢复可选 |
| C10 | stub | **删除**：最小示例模板与 e2e 改用真实模型档位；安装器不预置任何档位 |
| C11 | 通用终端协议的测试 | 管理员在档位上配置**测试命令与期望输出（正则）**；平台在该档位镜像的测试 Pod 里先跑完启动前步骤，再执行测试命令，输出匹配才算通过 |
| C12 | 沿用 agent-workflow 的字段 | 四组都带：**附加命令行参数**；**配置目录变量名与目录名**；**`IS_SANDBOX` 开关**；**opencode 的 `variant`／`temperature`／`steps`／`maxSteps`** |
| C13 | 模板与默认档位 | Manifest 可写 **`compute: default`**，解析到管理员在档位列表里「设为默认」的档位；去掉 `CS_DEFAULT_COMPUTE_PROFILE`；没有默认档位时发布校验失败 |
| C14 | 并发额度 | **每个 Agent Pod 占项目并发额度一个**，满额拒绝启动（沿用「＋ CLI」的规则） |
| C15 | 镜像仓库 | **只允许平台镜像仓库**；不接受外部地址，不需要拉取凭据 |
| C16 | 通用终端 CLI 使用平台 MCP | 两个 MCP 地址与本次启动的会话令牌，**既作为启动前步骤的模板变量，也放进 CLI 进程的环境变量** |
| C17 | `default` 的解析时机 | **每次启动 Agent 时解析**；管理员改了默认档位后，所有写 `default` 的业务立即跟着换 |
| C18 | 镜像怎么进平台仓库 | **平台给推送地址和凭据**：管理页显示推送地址、底座镜像引用和示例 Dockerfile，并签发有期限的推送凭据，管理员用 `docker push` 推入 |
| C19 | 停用与删除 | **照 agent-workflow**：有启用／停用开关；默认档位不能停用也不能删除（要先改默认）；删除被已发布 Manifest 引用的档位时，先列出受影响的项目，确认后允许删除 |
| C20 | 平台升级后用旧底座构建的镜像 | **不处理**：由管理员自己留意；起 Agent 时 Runner 握手失败再报错 |

## 3. 目标

1. 档位是业务与租户唯一的算力入口，也是管理员唯一的配置对象：选定档位，协议、镜像、二进制、参数、启动前步骤、模型和资源就全部确定。
2. 管理员能接入任何讲 `claude-code`／`opencode` 协议的二进制（官方版或 fork），也能把任意终端 CLI 以通用终端协议提供给开发者。
3. 二进制随管理员基于平台底座构建的镜像进入容器；每次启动使用保存时固定的镜像摘要，同一档位修订在任何时候启动的都是同一份镜像。
4. 每个 Agent 一个 Pod，不同档位的镜像、资源和进程互不影响，一个 Agent 失败只影响它自己。
5. 每次保存都在真实容器里跑一次测试作业；未通过的档位租户不可选，失败原因能定位到具体阶段。

## 4. 非目标

- 项目自带运行时或二进制（C2）。
- 外部镜像仓库与拉取凭据（C15）。
- 平台代为构建镜像：镜像由管理员自己构建、推送（C3、C18）。
- 平台升级后的自动重测与兼容提示（C20）。
- 通用终端协议下的事件解析、会话捕获、Agent 动态、headless Agent 与业务子任务（C6）。
- 平台定义新的标准事件流协议（第二轮已否决）。
- 草稿版本／启用版本两套版本、启用前必须检查、回退到旧版本（C7）。
- 用量计量与成本归集（沿用 RFC-001 的非目标）。

## 5. 档位对象（管理员视角）

### 5.1 字段

| 分组 | 字段 | 规则 |
|---|---|---|
| 身份 | 名称 | slug，建档后不可改；`default` 是保留字，不能用作名称（C13） |
| | 说明 | 给租户看的一句话，出现在下拉里 |
| | 启用 | 停用后租户不可选，已在运行的 Agent 不受影响（C19） |
| | 默认 | 全平台至多一个；Manifest 与 API 里的 `default` 解析到它（C13、C17） |
| 启动 | 协议 | `claude-code`／`opencode`／通用终端（C6） |
| | 镜像 | 只接受平台仓库地址（C15），管理员基于平台底座构建（C3）；保存时把标签解析为摘要并固定 |
| | 二进制路径 | 必填，容器内绝对路径，不回落协议默认名（C5） |
| | 附加命令行参数 | 追加到每次启动 argv 的末尾；平台保留的参数在保存时拒绝（C12） |
| | 配置目录变量名／目录名 | fork 改了读取配置目录的环境变量名或目录名时填写；留空用协议默认值（C12） |
| | `IS_SANDBOX` | 只是给 Claude CLI 设 `IS_SANDBOX=1` 这个兼容标记，不启用任何沙箱（C12） |
| 模型 | 模型 | 传给 CLI 的模型标识 |
| | `variant`／`temperature`／`steps`／`maxSteps` | 只对 opencode 协议生效（C12） |
| 资源 | 资源套餐 | 引用管理员定义的 TaskProfile，决定该档位每个 Agent Pod 的 CPU、内存和临时存储 |
| 启动前步骤 | 文件步骤、脚本步骤、变量、凭据 | 沿用 RFC-004：两类步骤按顺序执行，模板变量，`CS_HOOK_ENV_OUT` 输出约定，凭据的保留／替换／清除，GET 不返回原值 |
| 测试 | 测试命令、期望输出（正则）、超时 | 只有通用终端协议需要、且必填（C11）；两种已知协议由平台固定测试作业（§8） |

按协议生效的范围：

| | `claude-code` | `opencode` | 通用终端 |
|---|---|---|---|
| 模型 | ✓ | ✓ | — |
| 附加命令行参数 | ✓ | —（与 agent-workflow 一致） | ✓ |
| 配置目录变量名／目录名 | ✓ | ✓ | — |
| `IS_SANDBOX` | ✓ | — | — |
| `variant`／`temperature`／`steps`／`maxSteps` | — | ✓ | — |
| 测试命令与期望输出 | — | — | ✓（必填） |
| 平台自动注入 MCP 配置、Agent 动态 | ✓ | ✓ | —（MCP 地址与令牌经模板变量和环境变量交给管理员接入，C16） |
| 可以用于 | 「＋ CLI」、headless Agent、业务子任务 | 同左 | 只有「＋ CLI」 |

### 5.2 保存、生效与测试

- 保存即生效（C7）：没有草稿版本与启用版本。每次保存在内部追加一条不可变修订，只用来固定已受理启动的快照和留审计，不是草稿。
- 每次保存自动排一次测试（C9）。测试进行中与测试失败时，租户侧这个档位禁选，并写明原因；测试通过即可选。
- 已受理的启动固定受理当时的修订；已经在运行的 Agent 不受之后的保存影响。
- 已测试过的镜像标签被重新推送后，档位仍用保存时固定的摘要；要用新镜像，需要重新保存（会重新解析摘要并自动测试）。

### 5.3 默认、停用与删除

- 「设为默认」只能指向已启用、协议为 `claude-code` 或 `opencode` 的档位：`default` 会被 Manifest 的 `agentProfiles` 引用，而通用终端档位不能用于业务子任务。
- 默认档位不能停用，也不能删除；要先把默认改到别的档位（C19）。
- 删除被已发布 Manifest 引用的档位时，先列出受影响的项目；管理员确认后才删除。删除后，这些项目下一次起 Agent 时报「档位不存在」（C19）。

## 6. 租户与业务视角

- 开发页「＋ CLI」下拉：列出全部已启用档位，通用终端档位带「仅终端」标注；测试中、测试失败与停用的档位禁选并显示原因。
- headless Agent 的下拉：只列 `claude-code` 与 `opencode` 协议的档位。
- Manifest 的 `agentProfiles[].compute`：写档位名或 `default`。发布时有三种拒绝：档位不存在（列出可用名，沿用 RFC-001）；引用了通用终端档位；写了 `default` 而平台没有默认档位。
- 起 Agent：每次一个 Pod，依次经过排队（额度）、调度与拉取镜像、启动前步骤、CLI 在线；任何一步失败都只影响这一个 Agent。
- 租户看不到镜像、二进制、参数、启动前步骤和模型，沿用 RFC-001 的租户投影。
- 平台 MCP：两种已知协议自动注入；通用终端档位由管理员用模板变量或环境变量接入（C16）。

## 7. 每个 Agent 独立 Pod

- 四种启动都建独立 Pod：「＋ CLI」、headless Agent、业务任务里的 Agent 子任务、档位测试（C4）。
- Pod 使用档位修订固定的镜像摘要与资源套餐，挂父任务的工作卷；工作卷是 ReadWriteOnce 时，与父容器调度到同一节点。这些做法沿用 RFC-003 `cli-isolation.md` 已实现的「＋ CLI」规则。
- 每个 Agent Pod 占项目并发额度一个，满额就拒绝这一次启动，已在运行的 Agent 不受影响（C14）。测试 Pod 不占任何项目额度。
- 父容器（开发会话的工作区、业务任务的任务容器）继续用平台底座镜像，承担编辑、Git、预览、终端和命令子任务，不再启动 Agent。
- Agent 结束后回收它的 Pod 与额度；父任务释放时先回收全部 Agent Pod，再按原规则处理工作卷。

## 8. 测试作业

- 触发：每次保存自动触发（C9）；管理员也可以手动重测。
- 位置：平台命名空间里，按档位修订的镜像摘要与资源套餐建一个测试 Pod，不带任何项目源码或业务数据（沿用 RFC-004 已批准的做法）。
- 过程：拉取镜像 → Runner 握手（校验协议版本，C3）→ 按顺序执行启动前步骤 → 按协议执行测试：
  - `claude-code`／`opencode`：用档位的二进制、参数与模型，以 oneshot 模式发一个带随机 nonce 的提示；要求事件流可解析、拿到会话 id、回显 nonce，与 agent-workflow 的判定一致。
  - 通用终端：执行管理员配置的测试命令，退出码与输出匹配期望正则才算通过（C11）。
- 结论逐阶段给出：通过；镜像拉取失败；镜像里没有可用的 Runner 或协议版本不一致；启动前步骤失败（第几步）；二进制无法启动；缺少鉴权；网络不可达；模型调用失败；事件流不符合协议；测试命令输出不匹配；超时。错误摘录脱敏后保留。
- 记录：镜像摘要、Runner 协议版本、能取到时的 CLI 版本、解释器清单、各阶段的起止时间；记录与档位修订绑定。保存出新修订时，旧修订上正在跑的测试作废。

## 9. 与既有 RFC 和基线的关系

- **RFC-001**：保留「档位由管理员定义、业务按名引用、租户看不到厂商与模型」。档位字段从 `driver`／`model` 扩成完整的执行配置。删除档位从「允许删、不查引用」改为 C19。
- **RFC-003 I15（`cli-isolation.md`）**：「＋ CLI」独立 Pod 的准入、卷引用、同节点约束、每 Pod 占一个额度、末屏与清理，全部推广到所有 Agent；准入时冻结的镜像从平台任务镜像改为档位修订的镜像摘要。
- **RFC-004：Superseded。** 并入档位保留下来的有：两类启动前步骤、模板变量、`CS_HOOK_ENV_OUT` 输出约定、凭据的保留／替换／清除、执行记录与 unknown 语义、CLI 配置合成（Claude settings 合成、OpenCode 保留 provider options）、测试在平台命名空间起容器。取消的有：独立的运行环境对象、草稿版本与启用版本、启用前必须检查、回退到旧版本、部署配置模式。
- **基线**：Design §1.2 对象表、§10.1、§10.4、§10.8、§12.4，以及 R05「一任务一长驻容器」和 R43 配额计数口径的解释，都要随本 RFC 更新。实施完成后回填基线三件套；回填清单见 design.md §12。

## 10. 能力影响清单（breaking change，请逐项确认）

按开发规则 §5.5，本 RFC 关闭或收缩既有能力，逐条列出，每条都要有拒绝分支的测试：

| # | 被关闭或收缩的能力 | 影响面 | 替代 |
|---|---|---|---|
| B1 | 部署配置模式与 `CS_AGENT_ENV_SECRET`：未绑定运行环境的档位读安装时的环境文件 | `packages/settings`、任务 Pod 的 `agent-env` 挂载、Runner 读环境文件、管理页选项 | 档位上的变量与凭据 |
| B2 | 独立的「运行环境」对象、页签和 `/v1/admin/agent-runtime-configs…` 接口；本机运行环境 `kkk` 被删除 | 管理空间、api-client、`agent_runtime` schema | 档位本身 |
| B3 | 草稿版本／启用版本、「检查通过才能启用」、回退到旧版本 | RFC-004 的版本流程 | 保存即生效，测试通过前不可选 |
| B4 | `stub` 驱动与 `sample-stub` 档位；样例用回显驱动、不消耗真实算力 | 最小示例模板、Runner、contracts 枚举、播种脚本、大量单测夹具 | 真实模型档位；单测改用只在测试里注入的假驱动 |
| B5 | 安装器与本机脚本预置档位（`sample-stub`、`balanced`、`deep`） | `apps/cli` 安装、`deploy/local/seed-catalog.sh` | 管理员新建 |
| B6 | 安装配置 `CS_DEFAULT_COMPUTE_PROFILE` | `packages/settings`、dev-session | 管理员在档位列表里「设为默认」；Manifest 与 API 可写 `default` |
| B7 | 不填二进制时按协议默认名启动 | 驱动 | 二进制路径必填 |
| B8 | headless Agent 与业务子任务在已有容器里起进程 | dev-session、business-task、Runner | 每个 Agent 独立 Pod；启动多了调度 Pod、拉镜像、等 Runner 连接这一段 |
| B9 | 业务任务里的 Agent 子任务不单独占额度 | 业务程序：同样的并发会更早撞到额度上限而被拒绝 | 管理员调高项目额度 |
| B10 | 通用终端档位不能用于 headless Agent 与业务子任务 | 发布校验、开发页下拉 | — |
| B11 | 默认档位不能停用、不能删除 | 管理员操作 | 先改默认 |
| B12 | Runner 协议升级后，用旧底座构建的档位镜像起不来 | 平台升级 | 管理员基于新底座重建（C20） |
| B13 | 本机现有 4 个档位、运行环境 `kkk` 及其版本记录不迁移；已有开发会话与任务里的旧 Runner 与新协议不兼容 | 本机数据与正在运行的 QA 会话 | 管理员重建档位；实施时先释放旧会话（plan.md 排期约束） |

## 11. 用户故事

- **平台管理员，接入一个 Claude Code 的 fork**：在自己的机器上写 `FROM <管理页给出的底座引用>`，把 fork 的二进制拷进去，用管理页签发的临时凭据推到平台仓库。新建档位：协议 `claude-code`、镜像填刚推的地址、二进制 `/opt/fork/bin/claude`、附加参数填 fork 的私有开关、选模型；启动前步骤写一份 `settings.json`，凭据里放 API Key。保存后看到测试逐阶段推进；失败时看到「模型调用失败」和脱敏后的原文，改完再保存会自动重测。
- **平台管理员，提供一个终端 CLI**：协议选通用终端，镜像里装好这个 CLI；测试命令填 `["<cli>", "--version"]`，期望输出填版本号的正则；启动前步骤把平台 MCP 地址和令牌写进这个 CLI 的配置文件（C16）。
- **开发者**：在开发页「＋ CLI」下拉里选档位，每个窗口各有自己的 Pod，与其他窗口共享同一棵工作树；测试没通过的档位在下拉里是灰的，旁边写着原因。
- **业务开发者**：在 Manifest 里写 `compute: default` 或具体档位名；写错名称、引用通用终端档位，或平台还没设默认档位时，发布会被拒绝并说明原因。

## 12. 验收标准

1. 管理页只剩一张档位表，没有运行环境页签；档位字段按 §5.1 分组；二进制必填；镜像只接受平台仓库地址，保存时固定摘要。
2. 保存后自动测试，逐阶段显示结果；测试通过前，租户下拉里这个档位禁选并写明原因。
3. 同一个开发会话里，用两个不同镜像的档位各起一个 CLI：两者各在自己的 Pod、各用自己的镜像摘要，共享同一棵工作树。
4. headless Agent 与业务 Agent 子任务各起一个 Pod 并占额度；额度满时拒绝本次启动，已在运行的 Agent 不受影响。
5. 通用终端档位在「＋ CLI」里可用，不出现在 headless Agent 的下拉里，被 Manifest 引用时发布被拒绝。
6. `compute: default` 按当前默认档位启动；改默认后，下一次启动就换成新档位。
7. 删除被引用的档位时先列出受影响项目；默认档位不能停用，也不能删除。
8. 旧模式全部消失：代码与部署里再没有 `CS_AGENT_ENV_SECRET`、`stub`、`CS_DEFAULT_COMPUTE_PROFILE` 和运行环境接口。
9. 最小示例模板开通 → 首次发布 → `/chat` 经真实模型档位跑通。
10. 管理员用平台签发的临时凭据把镜像 `docker push` 进平台仓库；凭据过期后推送被拒绝；平台仓库之外的镜像地址在保存时被拒绝。
11. 用旧协议底座构建的镜像起 Agent 时，明确报告 Runner 协议版本不一致，不假装启动成功。

## 13. 待作者确认的设计提议

五轮问答没有覆盖、本文先按下列做法设计的点。请逐条确认或改判：

| # | 提议 | 理由 | 另一种做法 |
|---|---|---|---|
| P1 | 协议建档后不可改，换协议就新建档位 | agent-workflow 与 RFC-004 都如此；同一名称换协议会让已发布的 Manifest 悄悄换了行为 | 允许改协议，改后重新测试 |
| P2 | 两种已知协议的模型字段可以留空：留空时不传 `--model`，由二进制用自己的默认值；测试失败时提示「未指定模型」 | 与 agent-workflow 一致；有些 fork 的模型写在配置文件里 | 模型必填（RFC-001 的现状） |
| P3 | 只有影响执行的字段变化才生成新修订并自动重测；只改说明、启用／停用、设为默认不重测 | 否则改一个错别字也会让档位在测试期间不可选 | 任何保存都重测 |
| P4 | 已知协议的测试只跑一次 oneshot 协议轮次（与 agent-workflow 一致），不验证原生交互（TUI）模式；TUI 起不来时，在开发页该窗口失败时暴露 | TUI 需要真实终端交互，难以稳定地自动判定 | 另加一个 PTY 存活探测 |
| P5 | 提供「复制档位」：两个档位要共用同一套镜像与启动前步骤、只换模型时，复制一份再改 | C1 合并后没有共享引用；复制比引入「模板档位」简单 | 支持档位继承另一档位的启动配置 |
| P6 | 每个 Agent Pod 用私有 HOME，Pod 结束即清理；API 的 `resumeSessionId` 跨 Agent 续接不再保证 | 工作台目前没有调用它（`apps/console/src` 无引用）；同一 Agent 内多轮续接不受影响；私有 HOME 也不再把 CLI 缓存写进 `/work`（RFC-001 §9 遗留问题） | 把原生会话存储放到工作卷上平台专用、被 `.git/info/exclude` 忽略的目录，保证跨 Agent 续接 |
| P7 | 业务任务暂停（持久卷模式）时结束任务内全部 Agent Pod，恢复时不自动重起 | 与现在「暂停时删除容器、容器内进程随之结束」的行为一致 | 暂停时保留 Agent Pod |
| P8 | 删除时算「引用」的口径：各服务 preview／prod 两个槽上当前部署的发布，其 Manifest 按名称引用了该档位（经 `default` 间接引用的不算） | 只有这两个槽上的版本还会起子任务 | 统计全部历史发布 |
