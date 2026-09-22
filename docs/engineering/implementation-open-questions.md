# 实现期新增的待决问题

> 状态：待作者裁定（2026-09-12）
> 版本：0.1 · 日期：2026-09-12
> 来源：第一轮实现（控制面、工作台、任务容器、两个 MCP、CLI、两个接入容器）在本机 kind 集群上跑通后暴露的设计缺口
> 用法：每条给出「现状／为什么是问题／可选做法」，不含裁定。裁定后按 Design §15.3 的 Q 编号并入提案，本文对应条目改为「已裁定 → Qnn」

本文只收**设计层面**的未决项。纯实现缺陷已直接修复并在提交信息中说明；仅缺后续里程碑工作量的条目（M6 的安装器、HA、规模验证）不在此列。

## 目录

- [I1. 操作 MCP 的「以本服务身份调用内部 API」用的是谁的身份](#i1-操作-mcp-的以本服务身份调用内部-api-用的是谁的身份)
- [I2. 业务任务容器的 MCP 连接凭据](#i2-业务任务容器的-mcp-连接凭据)
- [I3. 长命 Agent 进程的 MCP 令牌续期](#i3-长命-agent-进程的-mcp-令牌续期)
- [I4. 开发会话令牌的授权范围放在哪一层](#i4-开发会话令牌的授权范围放在哪一层)
- [I5. Manifest env 项的 default](#i5-manifest-env-项的-default)
- [I6. Manifest 里没有 openPolicy](#i6-manifest-里没有-openpolicy)
- [I7. EventProducer 的 OpenAPI 无处登记](#i7-eventproducer-的-openapi-无处登记)
- [I8. 接入容器在发布包里的位置](#i8-接入容器在发布包里的位置)
- [I9. 项目命名空间到公司系统的出站](#i9-项目命名空间到公司系统的出站)
- [I10. 上游凭据的按需下发](#i10-上游凭据的按需下发)
- [I11. 配置版本记录没有修改人](#i11-配置版本记录没有修改人)
- [I12. Claude Code 流式输入帧的形状](#i12-claude-code-流式输入帧的形状)
- [I13. 管理员配置 Agent 运行环境并供租户使用](#i13-管理员配置-agent-运行环境并供租户使用)
- [I14. 失败开发容器的工作卷恢复](#i14-失败开发容器的工作卷恢复)
- [I15. 同一工作树中多个 CLI 的资源隔离](#i15-同一工作树中多个-cli-的资源隔离)
- [I16. Bun SQL 连接池偶发挂死：运行时与驱动的选择](#i16-bun-sql-连接池偶发挂死运行时与驱动的选择)
- [I17. 档位测试轮次的权限档位与 `{{mcp.*}}` 取值](#i17-档位测试轮次的权限档位与-mcp-取值)
- [I18. 发布构建 Job 的资源写死 1 CPU／2Gi](#i18-发布构建-job-的资源写死-1-cpu2gi)
- [I19. read-only／edit 两档去掉 bash，与只认「OpenCode 内」请求的模型服务相冲](#i19-read-onlyedit-两档去掉-bash与只认opencode-内请求的模型服务相冲)
- [I20. CI 里没有 GitLab：核心业务链路在 CI 没有实机证明](#i20-ci-里没有-gitlab核心业务链路在-ci-没有实机证明)
- [I23. 两个内置接入项目的仓库 manifest 仍是 v1，发不出新版本](#i23-两个内置接入项目的仓库-manifest-仍是-v1发不出新版本)

## I1. 操作 MCP 的「以本服务身份调用内部 API」用的是谁的身份

**现状**：`call_internal_api` 工具从 mcp-operations 进程出去，网关按源 Pod IP 解析调用方，解析到的是 mcp-operations，不是发起调用的数字人。

**为什么是问题**：工具名与文档都说「以本服务身份」，实际不是。Design §8 对工作台内嵌 Swagger 的同一问题给的解法是：试调请求经开发容器里的 TaskRunner 发出，从而以本服务的源 Pod 身份被网关识别。同一个问题在 MCP 这条路上没有对应条款。

**可选做法**：(a) 该工具改为把请求交给 TaskRunner 发出，与 Swagger 试调同一条路径；(b) 网关接受 mcp-operations 代发并按令牌里的服务改写调用方身份；(c) 取消该工具，Agent 直接从开发容器里发请求。

## I2. 业务任务容器的 MCP 连接凭据

**现状**：开发会话启动 Agent 时注入会话级短期令牌；业务子任务（`modules/business-task`）注入的仍是空头。

**为什么是问题**：Design §5.9 的「会话级短期令牌」一句写在开发会话语境里，但 §10 的业务任务容器用的是同一套 MCP 注入形状。业务 Agent 该不该、以什么身份访问平台 MCP，没有条款。

**可选做法**：(a) 业务子任务签发绑定到 businessTask 的等价令牌，授权范围按该服务而不是按用户；(b) 业务容器不连平台 MCP，能力说明经环境变量与 Manifest 给出；(c) 只连能力说明 MCP，不连操作 MCP。

**RFC-006 之后的新表现（2026-09-18）**：档位的启动前步骤可以写 `{{mcp.token}}`（C16）。业务子任务只拿到两个 MCP 地址、没有令牌，引用了 `{{mcp.token}}` 的档位用于业务子任务时会在启动前步骤报「模板变量未定义」；`{{mcp.capabilitiesUrl}}`／`{{mcp.operationsUrl}}` 照常展开。本条裁定后这一表现随之确定。

## I3. 长命 Agent 进程的 MCP 令牌续期

**现状**：令牌 TTL 4 小时。连接头在 CLI 进程 spawn 时冻结进配置文件，事后改不了；超过 4 小时的 Agent 进程会开始收到 401。

**为什么是问题**：交互式 Agent 可能整天挂着。目前唯一的恢复手段是新建一个 Agent。

**可选做法**：(a) TaskRunner 增加一条「更新 MCP 连接头」的命令，平台定期续签；(b) 令牌改为长有效期、靠会话活性回查撤销（现在已经在回查，过期只是兜底）；(c) 维持现状，工作台在临近过期时提示重开 Agent。

## I4. 开发会话令牌的授权范围放在哪一层

**现状**：`packages/http` 里一张显式路由白名单，逐条绑定令牌自己的项目或服务。新增一个操作 MCP 工具就要在白名单里补一行，否则 403。

**为什么是问题**：Design §5.9 只说「每次调用经 cs-api 校验开发会话授权」，没说校验落在哪一层。白名单是「失败关闭」的稳妥实现，但把 MCP 的工具集与网关层的一张表耦合起来了。

**可选做法**：(a) 维持白名单，接受「加工具要改两处」；(b) 各模块的 authorize 认识 `devSession` 这种 actor 并自行按项目收窄，白名单取消；(c) 令牌里直接带允许的操作集，由签发方（dev-session 模块）决定。

## I5. Manifest env 项的 default

**现状**：实现时给 `spec.env[]` 增加了可选的 `default`，生产组缺该键时用它；密钥不允许声明 default。没有它，模板仓库的首个标签必然发布失败（最小示例声明了 `GREETING`，而新项目的生产组是空的），M1 的门禁过不去。

**为什么是问题**：这是对 Manifest 契约的扩展，属于 Design §4 的范围，应由作者确认而不是实现方自行加入。

**可选做法**：(a) 采纳，并在 Design §4 的 Manifest 表里补一行；(b) 改为开通链在建项目时按模板预置生产组取值；(c) 改为首个发布允许缺键、只发 preview 槽并在工作台标注。

## I6. Manifest 里没有 openPolicy

**现状**：`APIProxy` 的 Manifest 无法声明某个操作是默认开放还是定向开放；参考代理只能在响应头与 README 里表达意图，实际策略由管理员在工作台逐条设置。

**为什么是问题**：Design §8 说发布后的代理「登记操作，标记为默认开放或定向开放」，但登记的来源（Manifest）里没有这个字段。

**可选做法**：(a) Manifest 的 `apis.exposes` 支持逐操作声明默认策略，管理员可覆盖；(b) 维持现状，策略一律由管理员在工作台设定；(c) 代理项目在 OpenAPI 的扩展字段里声明，发布时读取。

## I7. EventProducer 的 OpenAPI 无处登记

**现状**：`EventProducerManifestSchema` 没有 `apis` 字段，`registerRelease` 对 EventProducer 直接返回，其 `openapi.yaml` 只是文档。

**为什么是问题**：EventProducer 也有对外的 HTTP 面（接收 webhook），公司侧配置 webhook 时需要知道路径与请求形状。现在这份信息不进目录。

**可选做法**：(a) 维持现状，webhook 地址经工作台与 README 给出；(b) EventProducer 也登记到目录，但标记为「不可被其他数字人调用」；(c) 另立一类「入站端点」登记。

## I8. 接入容器在发布包里的位置

**现状**：仓库把两个接入容器放在 `integrations/`（与结构文档一致）；`apps/cli` 的发布包读取逻辑期望它们在 `templates/`。

**为什么是问题**：可能是有意的（发布包布局 ≠ 仓库布局），也可能是不一致。两者只能有一个是对的。

**可选做法**：(a) 发布包沿用仓库布局；(b) 发布包把两者与模板并列放进 `templates/`，安装器按同一套逻辑处理；(c) 发布包单独一个 `integrations/` 段。

## I9. 项目命名空间到公司系统的出站

**2026-09-22 关闭（[RFC-018](../../proposal/rfc/RFC-018-remove-egress-allowlist/proposal.md)）**：作者裁定出站 FQDN 白名单整体下线，本条的三种方案连同它们要约束的能力一起作废。
最终形态是方案 (b) 的一个收窄版：接入容器项目（`APIProxy`／`EventProducer`）的命名空间带一条 `crewstation-integration-egress` 网络策略，
对 `workload=service` 的 Pod 放开出向，代理直连上游；数字人项目不下发这条策略，其服务槽访问公司系统仍要经接口目录与网关放行表。
`/internal/egress/http` 通道与 `egress` 模块均已删除。以下为历史记录。

**2026-09-15 授权后的选择**：作者在具体切流、角色与三项实现方案已说明后明确“授权你所有动作，赶紧做”。按这次委托选择 (a)：管理员维护的现有白名单同时约束代理服务出站。进入实现，不再以待答复阻塞 RFC-003；历史现状和未通过的调用证据保留如下。

**2026-09-15 实施（RFC-003 第八十批）**：代理的受控 HTTP 出站已部署，通过平台服务域识别实际 APIProxy，按其项目及全局规则逐请求裁定；拒绝、批准、撤销、重新放行分别取得真实 403／200／403／200。开发者申请获批后，原开发容器经共享网关调用 GitLab 返回 200，Swagger 与 OpenCode MCP 的操作一致。实现和限额见 [proxy-egress.md](../../proposal/rfc/RFC-003-workbench-ux-redesign/proxy-egress.md)，不扩大任务／构建通用出口或 I10 凭据下发的完成范围。完整浏览器 J5 继续验收。

**现状**：本机 kind 集群上，项目命名空间的 Pod 到不了测试 GitLab（`host.docker.internal:8929`），只有 `crewstation-system` 可以。参考代理因此在部署后 504。

**为什么是问题**：代理容器按定义就要出站到公司系统。出站白名单目前是给任务容器与构建用的，代理服务槽的出站没有对应条款。

**可选做法**：(a) 代理项目的出站也走同一份白名单，由管理员维护；(b) `APIProxy` 类项目的命名空间默认放行其 `upstream.connection` 指向的地址；(c) 上游一律经由系统命名空间里的出口代理。

**2026-09-15 复验（RFC-003 第五十一批，仍待裁定）**：参考代理 v0.1.2 已正常上线，活动目录与网关路由修复已部署；原 files QA 的默认开放 GET 确实到达代理，但代理转发 GitLab 未取得响应。16:08:40Z 的只读对照中，两命名空间把 `host.docker.internal` 解析到相同地址；系统 API Pod 连 8929 端口用时 3ms，代理 Pod 返回 ETIMEDOUT。代理 workload=service，当前规则仅允许到系统命名空间与 DNS，额外的任务／构建规则不匹配它；未配置出口代理变量。已把上述三种方案再次呈作者选择，没有借本机服务更新授权替代此产品设计裁定，也没有更改网络策略。证据见 [RFC-003 implementation](../../proposal/rfc/RFC-003-workbench-ux-redesign/implementation.md#第五十一批上库部署与-i9-出站阻塞)。

## I10. 上游凭据的按需下发

**现状**：cs-auth 没有「按需下发上游凭据」的接口，参考代理只能从 Manifest 的密钥里取长期令牌。

**为什么是问题**：Design §8 明确写「代理是纯转发，凭据由 cs-auth 按需下发」。现状与该条款不符，且长期令牌留在代理容器里。

**可选做法**：(a) 实现该接口（cs-auth 按调用方与上游连接名下发短期凭据）；(b) 维持长期令牌，并把该条款降级为后续里程碑；(c) 凭据由网关在转发时注入，代理完全不接触。

## I11. 配置版本记录没有修改人

**现状**：`ConfigVersionDto` 是 `{ env, version, createdAt, keys }`，没有修改人；修改人只在单项上有。工作台的版本历史因此只能显示版本号、时间与键数。

**为什么是问题**：配置变更是生产影响面最大的操作之一，版本历史不带人不便追溯。

**可选做法**：(a) 版本记录补上修改人；(b) 维持现状，追溯靠单项上的修改人加时间比对；(c) 版本记录改为带上本次变更的键与各自修改人。

## I12. Claude Code 流式输入帧的形状

**现状**：交互模式下 Claude Code 驱动常驻一个进程，每轮向 stdin 写一帧 `stream-json`。`claude --help` 文档化了 `--input-format stream-json`，但**帧本身的形状**只在 Agent SDK 侧有文档（`SDKUserMessage`），CLI 侧没有。

**为什么是问题**：形状若不对，交互式 Agent 会静默不响应。这是移植时登记的残余风险，链式回退路径已实现。

**可选做法**：(a) 在 M0／T0.4 用真实 CLI 实测确认，形状不符就改；(b) 交互模式一律走链式回退，放弃常驻进程；(c) 两种模式都保留，按 CLI 版本选择。

## I13. 管理员配置 Agent 运行环境并供租户使用

**现状**：算力档位只有 driver／model；平台通过 `CS_AGENT_ENV_SECRET` 挂载一个环境文件，Runner 创建时读取一次（`packages/settings/platformSettings.ts:63`、`runtimes/task/src/runner.ts:85`）。2026-09-14 新镜像实机验收中的 Claude Code 进入登录选择，专用 Pod 未挂载模型配置；随后专用 OpenCode 档位已用无需认证的供应方完成真实模型轮次，但尚无管理员运行环境管理流程。

**作者已裁定**：配置由管理员完成、租户使用；采用两个注入点：（1）管理员定义配置文件及容器存放路径，启动 Agent 前预置；（2）管理员提供 Shell／Python／JS 等脚本，启动 Agent 前执行。两者统一为 Agent 启动前 Hook。当前实机验收使用 OpenCode。2026-09-14 已批准修订后的 RFC-004，并明确在 RFC-003 完结后启动开发。

**可选做法**：(a) 只给全局 Secret 增加编辑表单，仍需重建容器且无法按 Agent 配不同环境；(b) 管理员维护可验证、可启用的运行配置，算力档位引用，每次启动固定快照；(c) 租户在每个 CLI 自行登录，与作者职责要求不符。

已将方案 (b) 按作者两个 Hook 动作重写为获批的 [RFC-004](../../proposal/rfc/RFC-004-admin-agent-runtime/proposal.md) 与 [ADR-0004](../adr/0004-agent-runtime-module.md)，共 25 个验收案例。模板／脚本是主要配置入口，不再另做一套重复的供应方连接表单。

**2026-09-16 实施**：作者以会话目标“完整落地RFC-004并提交上库”要求立即实施，覆盖原“RFC-003 完结后启动”的排期。方案 (b) 已落地为生产代码与测试（新增 L3 `agent-runtime` 模块、档位绑定、Runner `beforeStart` 执行器、CLI 配置合成、平台命名空间的运行环境检查、管理空间编辑器与租户面就绪状态），随本批提交 main。实机验收与任务镜像重建仍未执行，逐项状态见 RFC-004 plan.md 实施说明。本条视为已处理。

## I14. 失败开发容器的工作卷恢复

**2026-09-15 授权后的选择与实现**：按作者本次全权委托选择 (a)，已实现固定原任务和工作卷的显式重建，旧 CLI 不自动重跑。第七十五批真实恢复原 OOM 工作卷，原 HEAD、七份文件摘要与个人布局保持，新 Runner／预览就绪并手动启动一个 OpenCode。契约和证据见 RFC-003 workspace-recovery.md、implementation 第七十五批。

**实现前故障**：2026-09-14 四窗实机验收中，`rfc003-verify-workbench` 的任务 `tsk_01a09eb4f03f7000ba011a517772cc09` 在 2Gi 上限下 OOMKilled／137，TaskRunner 与原 B、Claude、新 D／E 一并不可连接。工作卷仍 Bound；一次只读挂载确认 HEAD=`1aa2db9f9578edfce15dbf314f74302ac523de83`、工作树仍只有原 `?? .claude.json`。原认证文件内容没有读取或修改，正式／待验证槽均就绪。完整证据见 RFC-003 implementation 第四十六批。

`modules/task-runtime/application/lifecycle.ts:23` 的释放会删除 follow-container 卷；`:76` 的恢复仅接受 paused，暂停又仅对持久卷业务任务开放。开发会话没有保留旧工作卷重建失败容器的入口。`modules/task-runtime/application/createEnvironment.ts:54` 始终为开发会话分配新的 follow-container 卷，新建只从远端分支检出。将失败会话如实展示、保留页面草稿和显式新建确认属于本次 UX 修复；这些都不等于恢复原工作树。

**为什么是问题**：远端没有的提交与文件仍在失败容器的卷里，普通新建不能带回；把“释放后重开”当作恢复会删除它们。基线只批准业务持久卷暂停／恢复，不能把 failed → creating 的状态机箭头当成开发会话恢复流程已经获准并实现。

**可选做法**：

- (a) 增加显式“保留工作树重建容器”。固定原 taskId 与卷，先确认失败对象及卷仍可用、重新申请配额，再创建新 Runner；原进程与旧轮次不自动重跑。可选择管理员已提供的任务容器套餐，向用户展示变化；后续正常释放仍按既有规则回收卷。需补并发确认、幂等受理、创建失败补偿、历史终端不可恢复和新 Runner 身份的完整契约及验收。
- (b) 维持新建独立工作树，提供管理员取回指定未推送提交／文件的流程，再由用户决定如何带入新会话；不导出或提交认证文件。取回完成前保留原卷，避免把一次容器故障变成代码丢失。

**执行边界**：本次委托已确定并实现 (a)，失败补偿、原卷保留及重新选择套餐已实跑；不是提前实施 RFC-004 Hook。本条不取消 RFC-003 对新增 CLI 资源不足时保护已有窗口的要求，四窗 OOM 的防护和实机复验仍是未完工作。

## I15. 同一工作树中多个 CLI 的资源隔离

**2026-09-15 授权后的选择**：按作者本次全权委托选择 (a)，每个 CLI 独立 Pod，挂载同一工作树，使用平台配额和资源上限。进入多 Runner、卷引用和准入契约实现；不能用单容器扩大内存代替独立隔离。

**第七十六批实施进度**：已补全 [cli-isolation.md](../../proposal/rfc/RFC-003-workbench-ux-redesign/cli-isolation.md)；task-runtime 已实现独立执行容器、冻结资源、原卷引用、项目原子准入、持久准备／清理、父释放等待子环境、父恢复同节点，以及实际 Runner 身份绑定。数据库／假集群和真实 PTY 的相应自动验证已执行。当前工作台“＋ CLI”入口仍使用旧路径，管理员套餐绑定、多 Runner 终端与动态聚合、末屏和真实四窗／OOM 验收继续；未据此宣称完整隔离已上线。

**第七十七批实施进度**：管理员任务套餐绑定、持久启动派发、每窗独立连接、分来源游标与统一动态序号、末屏按需读取已接通。完整门禁 1274 pass／4 skip／0 fail，console 644ms；本机部署、真实资源不足／OOM 与四窗验收仍需继续，未推进 RFC-004。

**原定要求**：RFC-003 `development-workspace.md:81` 要求新增 CLI 资源不足只影响该次窗口，UX-AT-28／35 要求真实多 CLI 和四窗验收。I14 处理故障后的工作树恢复，不能替代故障前的隔离。

**历史证据（2026-09-14T13:54:46Z）**：主仓基线 `293a7d0124c4e1b34397a25ccce22f89b3aa6502`；现存 QA Pod `cs-rfc003-verify-files/task-01a09ff07aeb`／UID `fa4dcc5e-3eb6-4557-a6bf-b6301dca4160` 的 requests=limits 为 1 CPU／2Gi，实际 `memory.max=2147483648`、`memory.oom.group=1`、`memory.current=899342336`；该正常单 CLI 容器的 oom／oom_kill／oom_group_kill 计数都是 0。`/sys/fs/cgroup` 挂载为 `ro,nosuid,nodev,noexec,relatime`，当前环境没有可供 Runner 写入的子 cgroup。此处只记录现存容器事实，不伪造已终止旧 Pod 的 cgroup 读数，也未再次对活跃任务施加压力。临时原始记录为 `crewstation-rfc003-batch49-resource-facts.json`。

当时源码只限制 256 条名册／32 个运行中进程（`runtimes/task/src/terminal/nativeSupervisor.ts:41–64`）；所有 CLI 通过同一个 launcher／PTY backend 启动于当前开发容器（`:79–85`）。`modules/task-runtime/adapters/k8s/taskCluster.ts:66–74` 只给整个任务容器分配 resources；原生名册只有一个 runnerId（`packages/contracts/taskrunner/nativeTerminal.ts:15`），启动输入没有独立执行环境／资源额度（`packages/contracts/api/nativeTerminal.ts:7–10`）。没有逐 CLI 的资源准入或硬上限。

[Linux cgroup v2 文档](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files) 说明 memory.oom.group 启用时按组终止任务；在子 cgroup 内触发的 OOM 不跨出该组。[Kubelet 配置文档](https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/) 说明 cgroup v2 的 singleProcessOOMKill 默认 false。因此仅捕获子进程退出、扩大当前套餐、设置窗口个数或轮询剩余内存，不能证明“新增失败不影响已有 CLI”；修改节点全局 OOM 行为也不是本 RFC 已批准的隔离实现。

**已评估的两种完整实现方向（本次选择 a）**：

| 方向 | 执行与额度 | 对当前实现的影响 |
|---|---|---|
| (a) 每个 CLI 独立执行 Pod，同一工作树 | 保留开发工作区及预览；逐个 CLI 按管理员额度通过平台准入，子 Pod 有独立 requests／limits，超额启动只失败该 CLI。多个 CLI 挂载同一工作卷，按卷访问模式处理同节点约束或共享存储支持 | task-runtime 管执行子环境和工作卷引用；dev-session 管父会话、子执行环境与 agentId／terminalId 映射；session 按实际 Runner 转发输入／resize／事件。现有单 Runner 名册／活动投影需明确兼容与迁移，子环境结束不得删除共享工作卷 |
| (b) 保留单开发容器，逐 CLI 委派子 cgroup | 为 Runner／编辑／预览预留额度，CLI 及其准备进程、后代放入各自受限 cgroup，额度总和受容器上限约束；并发启动先原子预留，失败释放 | 保留当前 UI 对象与主 Runner；部署环境须实际支持受控 cgroup 委派，当前只读挂载不具备。需明确额度的管理员配置归属、跨环境支持、创建／取消／退出清理与异常补偿，不能静默降级为无硬隔离 |

两种方向都保持逐个启动、个人页签／分屏、同工作树编辑、独立预览和原 CLI 身份语义。所需额度和准入结果由平台解释，租户不填写窗口数量表单；没有可用额度时保留原工作区与进程。都须用受限环境实际验证新增进程耗尽内存、并发启动、子进程退出／重试、会话释放及 Runner／其他 CLI 存活，最后完成原四窗与尺寸验收。

**执行边界**：选择 (a)，利用平台现有 Kubernetes 额度与独立容器边界。本条按开发规则 §5.7 补全 RFC-003 后实施，底层与工作台接线的状态按上文区分；不调整节点配置、增加容器权限或取消原验收条件。RFC-004 仍等待 RFC-003 完结，其两个启动前 Hook 不先行实施。

## I16. Bun SQL 连接池偶发挂死：运行时与驱动的选择

**现状**：2026-09-16 本机 kind 集群上 cs-api 三次在数小时内进入“进程活着、数据库空闲、所有要用数据库的请求全部挂起”的状态（第八十四批 06:13Z、第八十五批 07:14Z 短暂、第八十六批 07:25Z）。第一次 `pg_stat_activity` 显示一条连接带着未结束的事务被池子复用、其余九条排在它持有的咨询锁后面；第三次十条连接全部 `idle`、没有锁，容器 CPU 与内存都很低，容器内 `/healthz` 与无身份的 `/v1/me` 都 4ms 返回，但任何要查库的请求都在 Bun 服务器 10s `idleTimeout` 后被网关 502。都发生在多个浏览器上下文同时打开开发页（动态轮询、名册、版本比较、布局写入）时。当前运行时是 Dockerfile 与 CI 锁定的 Bun 1.3.13，驱动是 `drizzle-orm/bun-sql` 直接使用 Bun 内建 `SQL`（`max: 10`）。

**为什么是问题**：工作台所有页面同时停在“载入中”，开发者无法判断是自己的会话还是平台出了问题；探针在第八十六批之前看不到这种故障，只能等人 `rollout restart`。本机 `cs-dev-pg` 上 10 连接／40 并发的八种事务形态压测都复现不出来，说明触发条件不在我们已知的事务写法里。

**已做的工程处理（不需要裁定）**：写锁改 try 锁轮询、读取改只读快照、连接串带 `idle_in_transaction_session_timeout=60s`（第八十四批）；`/healthz` 走同一连接池做 `select 1` 并以 3s 为界，探针 `timeoutSeconds: 5`，同类卡死约 45s 内由 Kubernetes 重启（第八十六批）。

**可选做法**：

| 做法 | 代价 | 风险 |
|---|---|---|
| (a) 升级 Bun 到 1.4.2（2026-09-05）并在本机观察一周 | 改 Dockerfile、CI 与 `engines`；`bun-types` 已是 1.4.2 | 发布摘要未提 SQL 修复，可能只是换个版本继续偶发；升级本身可能带来别的差异 |
| (b) 驱动换 `postgres.js`（drizzle 官方支持），Bun 只做运行时 | 改 `packages/persistence` 与 12 处 `db.transaction` 的类型；postgres.js 有连接级 `connect_timeout`／`idle_timeout`／`max_lifetime` 与更成熟的池子 | 引入一个外部依赖；数组参数等既有 Bun 特殊写法要重新核对 |
| (c) 保持现状，只靠自愈探针 | 无 | 每次卡死仍有约 45s 全平台不可用，且触发原因继续未知 |

**需要作者裁定**：是否允许改变 Bun 版本策略或驱动选择；在裁定前继续按 (c) 运行并记录每次发生的时间与当时的浏览器上下文数量。

## I17. 档位测试轮次的权限档位与 `{{mcp.*}}` 取值

**现状（RFC-006 实施中，2026-09-18）**：档位测试的真实模型轮次原先以 `read-only` 启动。本机实测 OpenCode Zen 免费档（big-pickle）对权限表里 `bash: deny` 的请求答 `403 FreeTierError`，一个真实可用的档位因此被判为不可用。现改为 `full`，与 RFC-006 design §6.2「与 agent-workflow 的判定一致」对齐（agent-workflow 冒烟的系统 persona 发空权限表，工具全在）。另外，档位步骤引用 `{{mcp.*}}` 时测试原先没有 MCP 上下文、模板必然展开失败；现在只在步骤内容引用了 `mcp.*` 时，给平台两个 MCP 的真实地址与一个不授予任何权限的占位令牌。

**为什么需要作者确认**：测试 Pod 跑在平台命名空间，那里没有网络策略；`full` 让模型在测试容器里可以执行 shell。提示词固定、容器是临时的空工作目录、不带项目源码与租户配置，但这仍是比最小权限更宽的默认。占位令牌让「模板能展开」可测，不代表「MCP 可连」可测。

**可选做法**：(a) 维持 `full`＋占位令牌（现状）；(b) 回到 `read-only`，接受部分模型服务下的假阴性，失败原因里附原文（已实现）让管理员自己判断；(c) `full`＋给 `profile-test` 工作负载加网络策略，只放行 cs-session、平台仓库与出站代理；(d) 新增专供测试的权限档（保留 bash、拒绝写工作区以外的路径）。

## I18. 发布构建 Job 的资源写死 1 CPU／2Gi

**现状**：`modules/release/adapters/k8s/buildKitBuilder.ts` 的构建 Pod 固定请求 1 CPU、2Gi。本机节点 CPU 预约满额时它一直 Pending，约 30 分钟后发布记为「构建失败：Job was active longer than specified deadline」（2026-09-18 RFC-006 验收项目的首次发布即如此，节点余量 550m）。

**为什么是问题**：构建资源不属于任何管理员可调的套餐，环境紧张时只能去缩别人的 Pod（需要所有者同意）。生产集群一般有余量，但同一问题会以「发布排队」的形式出现且原因只在 Pod 事件里。

**已做的工程处理（不需要裁定）**：构建 Pod 只跑 `git clone` 与 `buildctl` 客户端，镜像在 buildkitd 里构建（buildkitd 有自己的资源）；1 CPU／2Gi 与它的负载不符，属于实现缺陷，已直接改为 250m／512Mi（带用例）。

**仍待裁定**：构建资源要不要成为可配置项或跟随套餐。可选做法：(a) 安装配置增加构建资源（`CS_BUILD_CPU`／`CS_BUILD_MEMORY`）；(b) 构建资源跟随项目的服务套餐或一个管理员定义的「构建套餐」；(c) 维持固定值，发布记录在 Pending 时写明调度原因（Insufficient cpu）而不是只显示「正在构建」。

## I19. read-only／edit 两档去掉 bash，与只认「OpenCode 内」请求的模型服务相冲

**现状**：三档权限到 opencode 权限表的映射是 CrewStation 的裁定（`packages/agent-drivers/permission/opencodePermission.ts`）：read-only 与 edit 都 `bash: deny`，只有 full 放行。OpenCode Zen 免费档据此拒绝请求（见 I17）。本机没有付费模型，因此开发会话默认 edit 的 headless Agent、最小示例 `chat-v1`（read-only）等真实轮次都会被拒；平台把厂商原文写进失败原因。

**为什么是问题**：这是模型服务的策略，不是平台故障；但它让「本机用免费模型跑通最小示例 `/chat`」这条验收路径（RFC-006 CP-17）只能改用 full 档的 agentProfile。

**可选做法**：(a) 维持映射，本机验收用 full 档或付费模型；(b) edit 档把 bash 改为 `ask`（工具仍在请求里；headless 下 `ask` 的实际行为未验证，需先实测），read-only 不变；(c) edit 档放行 bash，与 agent-workflow 默认更接近。


## I20. CI 里没有 GitLab：核心业务链路在 CI 没有实机证明

**现状**：开通链第二步 `ensureRepository` 需要 GitLab，而 GitHub CI 的 `e2e` 作业里没有（`tests/e2e/README.md`「项目空间的用例在 CI 里是跳过的」）。2026-09-20 的 CI 运行 35497825404 里，`e2e` 作业 32 条用例跑了 18 条、跳过 14 条，其中 11 条是项目空间用例（项目概览与两个部署槽、发布与上线、运行与诊断、项目设置、成员管理及其布局）；`check` 作业里 `modules/scm/tests/gitlabIntegration.test.ts` 的 5 条真实 GitLab 用例同样跳过。`e2e` 作业还设了 `CS_SKIP_TASK_RUNTIME=1`，开发会话与业务子任务也不在 CI 的实机范围内。这些用例只在有 `aw-local-gitlab` 与本机集群的机器上跑；而那台 GitLab 的 compose 定义已丢失、组与令牌是手工引导的（CLAUDE.md「known, deferred gap」），仓库里没有可复现的搭建方式。

**为什么是问题**：管理员代建项目 → 建仓 → 首标签构建 → preview 槽 → 切流／回退、开发会话、业务子任务，是平台最核心的几条链路（AT-01、03、33、38、47）。它们的回归目前取决于「改动的人恰好在一台环境齐全的机器上跑了全量用例」；CI 是绿的并不说明这些链路没坏。`docs/engineering/testing.md` §10 已把它登记为头号防护缺口，`CS_TEST_REQUIRE` 里也预留了 `gitlab` 能力，但提供这项能力需要先决定下面的做法。

**可选做法**：(a) 仓库里补一套可复现的 GitLab 引导（compose＋`gitlab-rails runner` 建根令牌、`crewstation-test` 组与受保护标签权限），CI 新增一个定时或手动触发的 `full-e2e` 作业：起 gitlab-ce、装任务容器镜像、`CS_TEST_REQUIRE=e2e,gitlab,database` 跑全部实机用例；代价是作业耗时（gitlab-ce 冷启动数分钟、镜像约 1.5 GB）与 runner 内存余量需要先实测，且要先还上「GitLab 定义丢失」这笔债；(b) 写一个只实现平台用到的那部分 GitLab 兼容接口（项目、分支、标签、保护规则、Git HTTP）的轻量替身供 CI 使用；代价是替身与真实 GitLab 行为漂移的风险（令牌生效延迟、分支列表 30 秒缓存这类坑正是替身测不出来的）；(c) 维持现状，把「推送前在环境齐全的机器上跑全量」写成发布类改动的硬性要求，CI 只兜不依赖 GitLab 的部分。

## I21. 开发会话的 Agent 能观测预览，却调不到它

**现状**：RFC-016 让 Agent 经操作 MCP 读预览状态与输出、启停重启预览进程，但**没有给它一条调用预览的路**。RFC-006 之后每个 Agent 跑在自己的执行 Pod 里，不在开发容器内，所以 `127.0.0.1:<预览端口>` 是 Agent 自己的回环，到不了预览进程；`PreviewStatusDto.url` 指向用户域主机 `dev.<slug>.<domain>`，那上面有 ForwardAuth 登录跳转，而 Agent 手里的开发会话令牌是给 cs-api 用的、不是网关用户域的凭据。任务 Pod 确有一个 Service（`modules/task-runtime/adapters/k8s/taskObjects.ts` 在配置了预览时按 `env.podName` 建，80 → 预览端口），但 Agent 既不知道它的名字，平台也没有把它作为约定暴露过。

**为什么是问题**：Agent 能把预览救活、能读它打了什么，却没法验证「改完之后这个页面真的对了」——而这正是「改代码 → 自查 → 发布」闭环里最后一步。目前只能退回到让人在浏览器里看。工具描述已按事实写明这一点，不让 Agent 去撞 `127.0.0.1`。

**可选做法**：(a) `PreviewStatusDto` 增一项集群内地址（任务 Pod 的 Service，如 `http://<podName>`），并在能力说明里登记为约定；需要先确认 Agent 执行 Pod 与开发容器同命名空间、且网络策略放行；(b) 给操作 MCP 加一个 `call_preview` 工具，由平台代为请求预览并回正文，授权与放行判定留在平台侧，和 `call_internal_api` 同构；(c) 维持现状，预览验证仍由人在浏览器里做，Agent 只负责把进程弄活。

## I22. 开发会话一旦进入 failed，容器与工作卷就没有任何可用的清理入口

**现状**：`task_runtime.environments` 里状态为 `failed` 的开发会话，Pod 与 `-work` PVC 都还留在集群里，但两条清理路径都走不通（2026-09-21 实测，管理员身份、本机集群）：

- 释放接口 `DELETE /v1/projects/:projectId/dev-session?force=true` 对七个项目全部返回 **404 `开发会话 <serviceId> 不存在`**——按服务查「当前会话」查不到已 failed 的行。
- `/admin/cluster` 的删除操作对 `purpose=development-workspace` 的 Pod 会路由到所属领域执行（RFC-010 的 executionRoute），领域同样 404，于是操作记录为 `failed`、`httpStatus=404`、`reason=PlatformError: 开发会话 … 不存在`；Pod 上既没有 `deletionTimestamp` 也没有 finalizer，说明根本没发出删除。同一批里 `purpose` 不是开发工作区的三个 Pod 删除成功。
- 九个 `-work` PVC 的删除能力一律是关的，理由 `平台保留此资源；必须通过所属业务流程清理`——这是 RFC-010 有意的保护，但「所属业务流程」正是上面那条 404。

**为什么是问题**：清不掉的开发会话容器会一直占配额、占磁盘，并且它们的 TaskRunner 会永远重连（本机观察到 7 个旧容器合计每秒约两次握手，全被 `runner protocol mismatch` 拒掉，只刷日志）。作者要求「释放」时，平台没有任何入口能执行，只剩绕过产品路径直接删 Kubernetes 对象——而那会让记录与实际不一致，正是 RFC-010 想消灭的状态。本机这批是 9-12～9-20 的验收遗留，在真实企业里会是任何一次节点重启之后的常态。

**可选做法**：(a) 释放用例不再只认「当前会话」：按 `projectId`（或环境 id）查出未释放的环境，`failed` 也可释放，清理容器、PVC 与记录，幂等；(b) 只放开 `/admin/cluster`：`development-workspace` 的删除在领域返回「对象不存在」时降级为受管资源删除，并把降级写进操作记录与审计；(c) 新增一条管理员专用的「强制回收项目残留」项目级操作（RFC-010 的项目生命周期里已有同类入口），一次清掉某项目所有未释放环境的 Pod 与工作卷；(d) 维持现状，残留由作者按需手工清理，并在文档里写明这是已知缺口。

## I23. 两个内置接入项目的仓库 manifest 仍是 v1，发不出新版本

**2026-09-22 作者裁定：取方案 a，已执行完毕并关闭。** 两个项目的仓库 manifest 已迁到 v2、重新发版并切流到生产槽；随后经网关的真实调用取得 HTTP 200 与真实上游数据。

**更正一处根因**：RFC-013 其实带了 v1→v2 升级器（`modules/scm/adapters/persistence/legacyManifestUpgrade.ts`，
经 `POST /v1/services/:id/manifest-upgrade` 暴露），也已经让**新建**项目在建仓时把模板槽位换成真实 UUID
（`modules/scm/adapters/fs/initializeTemplateResources.ts`）。缺口只在**两头都不覆盖的那一类**：
RFC-013 之前建的仓库，而且从没有人在开发会话编辑器里打开过 `crewstation.yaml` ——
升级器挂在编辑器的 `ManifestUpgradeNotice` 上，要人打开文件才触发。这两个平台自建项目从没开过开发会话，于是一直停在 v1。
所以方案 (b) 对新项目已经成立，本次要做的只是对这两个存量仓库补一次一次性迁移。

**执行与证据**：每个仓库只改三处（协议号、`plan` → `servicePlanId`、每个 env 项补 `configDefinitionId`），
其余内容与注释不动；UUID 取自各项目实际的 `project.service_plans` 与 `config.definitions`。
推送前后都用平台自己的 `ManifestSchema` 校验，并把迁移前的 v1 原文交给平台的升级器做对照——
两者给出的 UUID 与取值**逐项一致**（仅键顺序不同）。

| 项目 | 提交 | servicePlanId | configDefinitionId |
|---|---|---|---|
| `reference-api-proxy` | `1d88a7d2` | `01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10` | `GITLAB_BASE_URL` `01a0c12a-de1a-7003-80f9-cb618d877832`；`GITLAB_TOKEN` `01a0c12a-de1a-7007-b3b7-9e90d87818ac` |
| `gitlab-event-producer` | `f24e880f` | 同上 | `GITLAB_WEBHOOK_SECRET_TOKEN` `01a0c12a-de1a-7006-9d22-56fd588962f3` |

随后两个项目各发一个标签：`POST /v1/services/…/releases` 均 202，标签 `v0.1.4`，构建与部署完成后状态 `ready`。
作者授权后切流成功（两个服务均 HTTP 200，路由与 `release.service_slots.active` 都翻到 blue）。
**切流接口的 `toSlot` 传的是角色不是物理槽**：待命槽当前角色即 `preview`，切完变 `prod`；
传 `prod` 会被 `physicalOf` 解析回当前线上槽并以「已经是当前线上槽」拒绝——第一次就错在这里。

闭环证据：从已登记的数字人 `cs-demo` 服务槽 Pod 经网关调默认开放操作
`GET /api/test-gitlab/v4/projects/29/repository/commits/{sha}`，得 HTTP 200 与真实 GitLab 数据，
返回的正是本次迁移提交 `1d88a7d2` 本身；代理日志记 `forwarded … status 200`，不含 `/internal/egress/http`。

**剩余可选项**：本仓 `integrations/*/crewstation.yaml` 里的 UUID 仍是模板槽位，这是有意的（建仓时才分配），
不需要改。若希望历史仓库不必靠编辑器才升级，可另行考虑把升级器接到发布前置检查上——不在本条范围。

### 原始记录


**现状**：2026-09-22 以真实管理员身份对参考 APIProxy 发起发布（`POST /v1/services/…/releases`，202，标签 v0.1.3，SHA `7dee80b`），平台在校验阶段拒绝：

```
crewstation.yaml 无效：apiVersion: Invalid input: expected "crewstation/v2"；
spec.service.servicePlanId: expected string, received undefined；
spec.env.0.configDefinitionId / spec.env.1.configDefinitionId: expected string, received undefined
```

本仓 `integrations/reference-api-proxy/crewstation.yaml` 早已是 Manifest v2，但 10 天前建仓时写进 GitLab 的那份还是 RFC-013 之前的 v1，从未迁移。
内置 GitLab EventProducer 由同一条 `bootstrap-integrations.sh` 路径建仓，同样受影响。发布失败只留 `failed` 记录，生产槽不受影响。

**为什么是问题**：这两个项目是平台自带的接入样例，也是「接入容器怎么写」的参考。它们现在处在「能跑但改不动」的状态——
任何需要重新发版的修复都推不出去。RFC-018 把 `/internal/egress/http` 删掉之后，集群里跑的 v0.1.2 会一直打到 404，
直到这条路打通为止（网络层已经具备条件：同一 Pod 直连上游实测 200）。

**为什么不在 RFC-018 里顺手修**：manifest v2 要求 `servicePlanId` 与每个 `configDefinitionId` 都是该项目**实际**的资源 UUID，
本仓那份里是模板槽位。填对需要先读该项目已有的配置定义与套餐，再决定是改仓库内容还是让平台在建仓时生成——这是产品决定，不是改一行。

**可选做法**：(a) 一次性迁移两个既有项目的仓库 manifest：读出各自的实际 UUID 写回 `crewstation.yaml` 并推送，之后正常发版；
(b) 让 `bootstrap-integrations.sh` 与建仓流程在写入模板时就把模板槽位替换成该项目分配到的 UUID，并对既有两个项目补跑一次；
(c) 平台对 v1 manifest 保留一条读时兼容（按名字解析套餐与配置定义），代价是 RFC-013 的「名称只作展示」又开一个口子；
(d) 维持现状，两个内置项目冻结在当前版本，文档写明它们不可再发布。
