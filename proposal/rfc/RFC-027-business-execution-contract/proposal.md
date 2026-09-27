# RFC-027 · 业务执行契约与 agent-workflow 平台接入｜Proposal

> 状态：Done · 2026-09-27。作者已批准完整实施、提交远端及本地部署；实现范围仅 CrewStation，aw 由外部 RFC 承接。
> 配套：[技术设计](./design.md) · [实施计划与验收](./plan.md)

## 1. 背景与证据边界

agent-workflow（下称 aw）需要长命令、并行 Agent、工作目录、工具事件、预算观测及人工等待后的恢复。把 OIDC 换成网关身份不足以完成平台接入。本 RFC 将这些需要提炼为通用业务执行契约，不在 CrewStation 内实现 aw 的工作流调度器。

源码核对基线为 CrewStation `01ecfc1f20b1588341b351216ad7cc029042b05d`，2026-09-27；本轮无集群实跑。aw 的需求来自作者提供的对照报告，未把其中的路径和行号当成本轮独立核验结果。外部仓库只读，aw 实施由其自身 RFC 承接。

| 当前事实 | 源码依据 | 对设计的影响 |
|---|---|---|
| D64 已对所有项目 Pod 放开出网 | `packages/k8s/objects/cluster.ts:38-53` | 不新增出网例外，也不以网络不可达强迫业务改用代理 |
| 服务槽渲染没有工作卷参数；目前只支持 rolling-compatible | `modules/release/adapters/k8s/slotDeployer.ts:10-15`；`packages/contracts/manifest/serviceSpec.ts:15` | 本方案将执行文件留在任务卷，不扩展服务槽 PVC |
| 两槽注入生产数据和配置，CS_SLOT 是物理槽 | `modules/release/application/pipelineEnv.ts:18-38` | 不能用启动环境变量判断动态执行权 |
| 命令发出后等完整结果，通用会话回执限时 30 秒 | `modules/business-task/application/subtaskLaunch.ts:52-59`；`modules/platform/wiring.ts:352`；`modules/session/domain/commandTimeout.ts:5-13` | 分离受理回执、进程结果和取消确认 |
| resumeSessionId 校验后未进入 SubtaskRun | `packages/contracts/api/businessTask.ts:33-49`；`modules/business-task/application/subtaskLaunch.ts:79-90` | 接受字段必须产生效果或明确报不支持 |
| 契约按 release 保存，构造子任务却读取 latest | `modules/business-task/application/registerContracts.ts:4-11`；`modules/business-task/application/subtaskLaunch.ts:83-90` | 父任务固定 release 契约，不能随待命发布漂移 |
| API 有文本 output，无业务文件／游标事件路由 | `modules/business-task/http/serviceRoutes.ts:18-29` | 新增有归属校验的业务读取面 |
| execOutput 当前不持久化 | `modules/session/domain/eventDurability.ts:3-9` | 仅改 wait=false 会丢失断线期间输出，必须一起补事件存储 |
| 创建任务直接透传 body，未读取 trace 请求头 | `modules/business-task/http/serviceRoutes.ts:18` | 新契约明确 trace 的来源与冲突处理 |
| readiness 与 liveness 共用 healthPath，没有 startupProbe | `packages/k8s/objects/workloads.ts:32-36` | 接入需要启动保护和独立就绪语义 |

以上是设计动机，不是对两个仓库的全量审计。原报告中的默认卷模式、systemPromptFile、槽注释问题纳入接入相关修补；aw 的历史文档修正不在本仓改动范围。

## 2. 已确定方向与本稿设计选择

作者接受的方向：**B，算力归平台；服务槽承载控制面；业务任务容器承载 git、工作区助手和脚本；每次平台 Agent 调用运行于独立执行 Pod 并占额度。** 不以 A/C 作为上线过渡，不把平台额度绕过登记为本 RFC 的例外。

本稿进一步给出可审阅的实现选择，随完整 RFC 审批，不把这些细节伪称为作者逐条裁定：

| 编号 | 设计选择 |
|---|---|
| D1 | 平台管模型、凭据、镜像、资源与额度；业务管任务提示词、版本化 skills、MCP 引用和非保留环境变量 |
| D2 | 新业务契约用 `/v3`，严格拒绝未知字段；保留 `/v2`，不静默改变所有存量业务 |
| D3 | aw 使用 persistent 父任务；创建、提交、重试、暂停恢复及取消均可幂等；配额满即返回 429，不引入平台容量等待队列 |
| D4 | 配置、release 契约、会话及每次执行的档位修订可追溯；恢复不能把续跑静默改成新会话 |
| D5 | aw 启用 fenced 执行控制：在线槽、发布世代和实例租约共同决定调度权；待命槽对生产任务只读 |
| D6 | 平台负责可靠状态、事件补读与确认停止；aw 负责 DAG、业务重试、工作区合并和软 token 预算 |
| D7 | aw 的独立子代理映射成平台独立 Agent 子任务；CLI 内部委派另标内部行为，不宣称逐 Agent 隔离计额；aw 首期不依赖这种内部委派 |
| D8 | 首期提供会话续跑，但按档位能力声明；驱动不支持时明确拒绝，由 aw 显式选择 fresh／clean-restart |

## 3. 目标与用户故事

1. 业务开发者提交一次仓库操作，立即取得稳定句柄；运行几分钟、平台重启或 HTTP 回执丢失都不会导致重复执行或误报失败。
2. 业务开发者为节点提供提示词、skills 与 MCP，引用管理员授权的算力档位；平台不会让业务环境变量覆盖模型连接与 Runner 身份。
3. 工作流页面能补读工具调用、输出、会话 ID 和可用的 token 用量；未知用量显示未知，不能当成零。
4. 用户等待人工审批时，应用在无活动执行后暂停任务，保留工作卷并释放 Pod／额度；恢复后目录和会话来源可以核验。
5. 项目负责人发布新版本时，旧槽不能继续派发；新槽接管既有任务的控制，不把仍在执行的 Pod 判成孤儿，也不改变任务的旧执行契约。
6. 平台运维能看到请求键、任务、attempt、Pod、release、修订和 trace 的关联，区分失联、取消中、已退出及清理失败。

## 4. 非目标

- 不在平台实现 aw 的 DAG、节点重试策略、iso／merge 算法和任务预算产品。
- 不扩展服务槽持久卷、SQLite 单写者发布或任意常驻业务 executor。
- 不实现跨节点 RWX、跨集群工作区迁移、通用对象存储、任意大文件传输。
- 不承诺外部 git push／上游 API 的 exactly-once，也不承诺严格 token 花费上限。
- 不修改 aw 仓库，不将通用 K8s 部署准备完成等同于 aw 已在 CrewStation 上线。

## 5. 能力影响与兼容清单

| 能力／形态 | 变化与处理 |
|---|---|
| 现有 v2 业务任务 | 保留入口和 DTO；长命令可靠性修复可共享底层，不能改变成功输出或取消语义而不加回归 |
| v3 未知字段、保留 env、未知能力 | 显式 400／412；不接受后忽略，属于新契约边界 |
| fenced 服务的待命槽 | 仍能展示生产只读视图；禁止创建／驱动生产任务。需要完整可写验收时使用独立测试项目，不偷建同库“测试任务” |
| 切流后的旧槽 | 生产执行变更被拒；只读历史保留。当前正在跑的执行由新控制者接管观察，不随 HTTP 切流自动杀死 |
| aw 的原生内部子代理 | 首期 aw 配置改为平台子任务；不透明原生委派不提供逐 Agent 计额保证。不得把仍使用该能力的 aw 称为完整迁移通过 |
| aw 的显式模型选择 | 平台模式映射为授权档位；无法表达的节点配置明确报不支持，不偷偷替换模型 |
| 会话恢复 | 只恢复归属、卷、协议和档位修订兼容的会话；不兼容报错，不自动 fresh |
| schema 回退 | `rollback: blocked` 不能替代迁移前停写；非兼容变更必须证明写者已停，无法证明则阻止执行迁移 |
| 人工等待中的活动 Agent | 不自动 pause 杀进程；aw 等完成或显式取消且确认停止后才 pause |

以上收缩项在完整 RFC 批准时一并审阅，并要求正反向测试。现有服务不默认启用 fenced 模式；启用前必须通过交接契约验证。

## 6. 完成标准

以 [plan.md](./plan.md) 的 BE-01～BE-24 为准：平台能力验收与 aw 接入验收分别记录。平台侧用真实测试业务客户验证契约，不能用模拟 aw 通过冒充 aw 已上线。完整接入要求两边 RFC 的候选版本、数据库迁移、发布交接和真实任务闭环都有证据。

## 7. 风险与容量边界

父工作区也占一个额度。项目额度为 3 时，一个运行父任务最多同时容纳两个 Agent Pod（无其他占用时），不是三个。多个只占父额度的空闲任务可能挤满容量；aw 必须按可用容量控制激活任务数，空闲任务暂停，平台返回可重试背压。

共享 RWO 工作卷限制调度位置；父工作区进程与 Agent 必须使用相同 `/work` 路径。暂停只保留文件，不保留内存进程。工作目录与会话目录共享意味着同一任务的 Agent 不是互相隔离的安全租户；业务用独立 iso 控制并行写，平台只提供路径边界和会话互斥。

出网全放开、任务可以执行任意业务脚本是既有边界。平台契约不等于对任意恶意进程的模型调用防绕过系统；本 RFC 保证平台受理的 Agent 调用均按档位与额度执行，不夸大为网络层强制计量。
