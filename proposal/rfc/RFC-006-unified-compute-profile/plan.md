# RFC-006｜实施计划

> In Progress · 2026-09-18 作者设定会话目标「完整实现RFC并提交上库」，据此进入实施。按下表小批推进；每批自带测试（开发规则 §4），门禁绿了再按精确路径提交（§2、§3）。
>
> 2026-09-18 进度：T1–T10 与 T13 的代码与自动化证据已落地（见文末「实施说明」）；T11 的基线回填与 T12 的实机验收在本机部署后进行，尚未执行。

## 任务

| 编号 | 工作 | 依赖 | 完成证据（预期） |
|---|---|---|---|
| T1 | 契约与 Runner 协议 2：`AgentProtocolSchema`（删 `stub`、加 `terminal`）、`LaunchSpec` 与字段适用矩阵、档位管理 DTO、租户投影、测试记录 DTO、`startAgent`／`startAgentTerminal` 改用 `launch`、`probeTerminal`、`capabilities.protocols`；删除运行环境接口契约 | 作者批准 | contracts 用例：协议矩阵、`startAgent` 拒绝 `terminal`、`default` 保留字、协议 1 的 hello 被拒 |
| T2 | agent-runtime 成为档位宿主：断代迁移（drop 旧四表与 `project.compute_profiles`，建 §3 四表）、修订与内容哈希、凭据、可用性、默认／启用／删除与引用确认、复制、保存即排测试、管理员与租户路由、三个端口；project 删除 `ComputeProfile` 全部代码 | T1 | 模块集成测试覆盖 design.md §10 的 agent-runtime 条目；project 删除后的源码层断言 |
| T3 | 驱动与 Runner：接通 `binaryPath`／`extraArgs`（移植保留参数校验）／配置目录覆盖（移植保留变量与叶子名校验）／`IS_SANDBOX`／opencode 参数；通用终端 PTY 启动与 `CS_MCP_*`；`probeTerminal`；删除 stub 驱动与 `agentEnvFile`；Dockerfile 加 `/opt/crewstation/bin/task-runner` | T1 | agent-drivers 与 Runner 单测：argv／env 精确断言；本机真实 PTY 用例；删除项的源码层断言 |
| T4 | task-runtime 执行环境推广：`AgentExecution` 四种 purpose、准入与额度、Pod 规格（摘要、显式命令、`runAsUser: 0`、无 `agent-env`）、握手失败与容器启动失败原因回写、暂停时结束执行环境 | T1、T3 | 数据库／假集群用例覆盖 design.md §10 的 task-runtime 条目 |
| T5 | dev-session：headless Agent 经执行环境派发，消息与取消路由到子 Runner、列表与动态汇聚；「＋ CLI」取档位摘要；通用终端档位只进「＋ CLI」；`default` 在启动时解析；删除 `defaultComputeProfile` | T2、T4 | dev-session 用例；历史对话 headless 路径回归 |
| T6 | business-task：Agent 子任务经执行环境派发并占额度、满额 failed 的文案、交互子任务消息路由、契约校验在子 Runner | T2、T4 | business-task 用例；最小示例 `/chat` 路径的假 Runner 回归 |
| T7 | 测试作业：执行器改写（镜像拉取、握手、启动前步骤、已知协议 nonce 与失败分类、通用终端命令匹配、`unknown`、`superseded`），分类正则从 agent-workflow 移植并带回归 | T2、T3、T4 | 假集群／假 Runner 逐阶段用例；分类正则回归（含 `503`／`529` 误命中） |
| T8 | 镜像：安装时把底座推入 `<registryBase>/crewstation/task-runtime:<版本>`；保存时解析摘要与前缀校验；网关仓库主机＋cs-auth 推送凭据签发与校验；`GET /v1/admin/runtime-images` | T2 | 先完成 design.md §13 四项实测并留证据；cs-auth 鉴权端点用例（过期、越权路径、签名错） |
| T9 | release、capabilities、settings、模板、CLI 安装与本机脚本：三种发布拒绝；capabilities 改源；删除 `CS_AGENT_ENV_SECRET`、`CS_DEFAULT_COMPUTE_PROFILE` 与安装播种；模板改 `compute: default` | T2 | release 三种拒绝用例；安装器不播种的用例；全仓源码层断言 |
| T10 | 控制台：管理页一张档位表与编辑器（按协议显隐字段、复用步骤与变量组件）、测试时间线、默认／停用／删除确认、推送信息卡与凭据签发；租户两个下拉的过滤与禁选原因；删除运行环境页签 | T2、T7、T8 | 前端用例（design.md §10 的 console 条目）；多分辨率与明暗主题在 T12 实机核对 |
| T11 | 文档：ADR-0005 置为已接受并同步结构文档 §5；RFC-004 置为 Superseded；实机验收后按 design.md §12 回填基线三件套 | T12 | 文档提交 |
| T12 | 实机验收：下表 CP 逐项，浏览器实跑 | T5–T10 | 每项一条证据（截图／接口回放／数据库快照／`kubectl` 输出），证据目录写进 `STATE.md` |
| T13 | 本地完整门禁、按精确路径提交、推送后按自己的 SHA 盯 CI 到绿 | 每批 | `bun run check` 全绿＋CI run 链接 |

排期约束：

- **T1、T3、T4 必须同批部署**：Runner 协议从 1 升到 2 后，本机现有的开发会话与业务任务里的旧 Runner 全部握手失败（B13）。部署前要逐个核对本机 RFC-003 QA 会话的工作树里有没有需要保留的未推送内容（例如 files QA 分支上未推送的提交），**向作者确认后**再释放；不能为了部署静默释放。
- **T8 先于 T7 的实机部分**：测试作业要从平台仓库拉档位镜像。
- **T9 的模板改动与不播种会让「新建项目」依赖默认档位**：本机部署后，先由管理员建一个档位并设为默认、测试通过，再做开通类验收。
- T2 的断代迁移会删掉本机 4 个档位与运行环境 `kkk`，这是作者裁定 C8 的明确结果。

## 验收案例

| 编号 | 场景 | 必须证明 |
|---|---|---|
| CP-01 | 管理页结构 | 只有一张档位表、没有运行环境页签；字段按协议显隐；二进制必填 |
| CP-02 | 接入自定义 fork | 用签发的临时凭据推送基于底座的镜像 → 建档 → 自动测试逐阶段通过 → 租户下拉可选 → 起 CLI，Pod 的 `imageID` 等于保存时固定的摘要 |
| CP-03 | 官方 CLI 档位 | 以底座镜像加 `/usr/local/bin/claude`、`/usr/local/bin/opencode` 各建一个档位，各完成一次真实模型轮次 |
| CP-04 | 测试失败分类 | 错误模型、缺少凭据、网络不可达、二进制路径错、镜像不是基于底座构建、旧协议底座，各自落在正确的阶段并给出原因 |
| CP-05 | 保存即生效与自动测试 | 保存后测试中，租户侧禁选并写原因；通过后可选；保存前已在运行的 Agent 不受影响 |
| CP-06 | 只改说明 | 不生成新修订、不重测、可用性不变（P3） |
| CP-07 | 通用终端协议 | 测试命令匹配时通过、不匹配时失败；「＋ CLI」可用；headless 下拉里没有；Manifest 引用时发布被拒；CLI 进程里有 `CS_MCP_*`，启动前步骤可用 `{{mcp.*}}` |
| CP-08 | 同会话两个镜像 | 两个不同镜像的档位各起一个 CLI：各自一个 Pod、各自的摘要，共享同一棵工作树 |
| CP-09 | headless Agent | 独立 Pod；消息与取消生效；占额度；结束后 Pod 与额度回收 |
| CP-10 | 业务 Agent 子任务 | 独立 Pod 且占额度；额度满时子任务 failed 并写明原因；命令子任务不占额度 |
| CP-11 | `compute: default` | 解析到当前默认档位；改默认后下一次启动就换；没有默认档位时发布与起 Agent 都被拒 |
| CP-12 | 默认、停用、删除 | 默认档位不能停用、不能删除；删除被引用的档位先列出项目，确认后才删除；删除后相关项目起 Agent 报「档位不存在」 |
| CP-13 | 停用 | 租户不可选；已在运行的 Agent 继续运行 |
| CP-14 | agent-workflow 四组字段 | 附加参数、配置目录变量名与目录名、`IS_SANDBOX`、opencode 参数确实进入进程 argv 与环境（容器内 `ps` 与 `/proc/<pid>/environ` 为证） |
| CP-15 | 启动前步骤 | 文件、脚本、`CS_HOOK_ENV_OUT`、凭据在 Agent Pod 内生效；失败时阻断 CLI 并定位到步骤 |
| CP-16 | 旧模式消失 | 源码与部署清单里没有 `CS_AGENT_ENV_SECRET`、`stub`、`CS_DEFAULT_COMPUTE_PROFILE` 和运行环境接口 |
| CP-17 | 最小示例 | 设好默认档位后开通新项目 → 首次发布 → `/chat` 经真实档位跑通 |
| CP-18 | 仓库边界 | 过期凭据推送被拒；越权路径推送被拒；平台仓库之外的地址在保存时被拒；不存在的标签在保存时被拒 |
| CP-19 | 业务任务暂停 | 暂停时结束任务内全部 Agent Pod，恢复时不重起（P7） |
| CP-20 | 并发编辑 | 两个管理员同时保存，后到的一方 409 且表单保留 |
| CP-21 | 复制档位 | 复制出的新档位内容相同、凭据按「已设置」复制、自动测试独立进行（P5） |
| CP-22 | 管理 UX | 1280／1024／768／390／320、明暗主题、键盘与错误焦点可用（沿用 RFC-004 AR-16 的标准） |

所有 CP 条目保留实际账号与角色、档位名与修订、镜像引用与摘要、Agent／taskId、Runner 协议版本与结果。

## 证据

实机证据放在 `/private/tmp/crewstation-rfc006-*/`，路径与 CI run 写进 `STATE.md`；本文件在每批完成后补「实施说明」表，逐项区分自动化证据与实机证据，不以自动化结果宣称实机通过。

## 实施说明（2026-09-18）

自动化证据指仓库内用例与门禁（本地 `bun run check`，CI 按提交 SHA）；实机证据指本机集群上的实际操作记录。下表不以自动化结果宣称实机通过。

| 编号 | 状态 | 自动化证据 | 实机 |
|---|---|---|---|
| T1 | 完成（2635e27） | `packages/contracts/taskrunner/launch.ts` 与 `launch.test.ts`（字段适用矩阵、保留参数与变量前缀、`default` 保留名）；`protocol.test.ts`（协议 2 必填字段、`startAgent` 拒绝 terminal、hello 拒绝协议 1）；`api/compute/computeProfile.ts` | 未执行 |
| T2 | 完成（2635e27） | `modules/agent-runtime/**`：`domainRules.test.ts`、`computeProfileModule.test.ts`（修订与内容哈希、凭据 keep／replace／clear、可用性四种原因、默认／停用／删除与引用确认、复制、保存即排测试、新修订作废旧测试、HTTP 权限与租户投影）；迁移 `0003_compute_profiles.sql`（断代）；project 删除档位代码与迁移 `0008_drop_compute_profiles.sql` | 未执行 |
| T3 | 完成（2635e27） | `packages/agent-drivers` 与 `runtimes/task`：argv／env 精确断言、终端协议与 `CS_MCP_*`、`probeTerminal`（超时、截断、正则、重复尝试）、删除项的源码层断言（`removedSurfaces.test.ts`）；Dockerfile 的 `/opt/crewstation/bin/task-runner` | 两个原生动态验收用例需在 Linux 任务镜像内跑（`CS_NATIVE_ACTIVITY_ACCEPTANCE=1`），未执行；镜像未在集群构建 |
| T4 | 完成（7cbe22f） | `modules/task-runtime/tests/agentExecutions.test.ts`（三种用途的准入与额度、档位镜像按摘要、显式 Runner 命令与 `runAsUser: 0`、握手被拒回收并释放额度、镜像拉取／容器起不来立即失败、暂停结束子执行环境且恢复不重起）；`taskRuntimeModule.test.ts`（无 agent-env） | 未执行 |
| T5 | 完成（7cbe22f） | `modules/dev-session/tests/profileLaunch.test.ts`（headless Agent 受理即登记执行环境、子 Runner 就绪后派发且不重复、额度满、消息与取消路由到子 Runner、终态后回收不重启、执行环境失败原因、未派发即取消）；`devSessionModule.test.ts`（`default` 每次启动解析、终端档位只进「＋ CLI」） | 未执行 |
| T6 | 完成（7cbe22f） | `modules/business-task/tests/businessTaskModule.test.ts`（子任务各自执行环境、额度满失败文案、子 Runner 未连上时等待、消息路由、执行环境丢失时失败带原因、未开始即取消回收、修订固定与 `default` 解析） | 未执行 |
| T7 | 完成（2635e27） | `modules/task-runtime/tests/profileTest.test.ts`（假集群／假 Runner 逐阶段：通过、启动前步骤失败、超时取消、镜像拉取失败、容器起不来、协议不一致、终端命令通过与不匹配、租约丢失与环境中途失败记 unknown）；`profileTestClassifier.test.ts`（移植 agent-workflow 的正则回归，含 `503`／`529` 误命中与十万次 nonce） | 未执行 |
| T8 | 代码完成（2635e27） | 保存时解析摘要与前缀校验（agent-runtime 用例）；推送凭据签发与仓库 ForwardAuth（`pushGrant.test.ts`、`computeProfileModule.test.ts`：过期、越权路径、签名错、删除与目录列举被拒）；`deploy/k8s/platform/41-registry-gateway.yaml`、`deploy/local/publish-base-image.sh` | design.md §13 四项实测未执行 |
| T9 | 完成（2635e27） | release 三种拒绝；capabilities 改源；CLI 安装不播种（`installInitialize.test.ts`、`installConfig.test.ts`）；模板 `compute: default`；settings 删除 `CS_AGENT_ENV_SECRET`／`CS_DEFAULT_COMPUTE_PROFILE` | 未执行 |
| T10 | 完成（2635e27 管理页；7cbe22f headless Agent 的执行环境流） | `apps/console/src/tests/compute*.test.ts*`（档位表、按协议显隐、测试时间线、默认／停用／删除确认、推送信息卡、租户下拉过滤与禁选原因、无运行环境页签的源码层断言）；`agentExecutionStreams.test.tsx`（每个未结束的执行环境一条流、选中已结束的 Agent 时回放且不重复、老 Agent 仍读父会话流、准备中与失败原因的呈现） | 多分辨率与明暗主题未核对 |
| T11 | 部分 | ADR-0005 与结构文档 §5 已同步；RFC-004 已置 Superseded；ADR-0005 待作者复核后再标「已接受」 | 基线回填待 T12 之后 |
| T12 | 未开始 | — | 待本机部署 |
| T13 | 每批执行 | 2635e27：本地门禁全绿，并在隔离目录单独跑过提交树的门禁；CI run 35308530121 成功。7cbe22f（每个 Agent 一个 Pod）：本地门禁全绿（1546 pass）；CI run 35310598962 成功 | — |
