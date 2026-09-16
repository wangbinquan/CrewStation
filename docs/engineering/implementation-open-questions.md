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

## I1. 操作 MCP 的「以本服务身份调用内部 API」用的是谁的身份

**现状**：`call_internal_api` 工具从 mcp-operations 进程出去，网关按源 Pod IP 解析调用方，解析到的是 mcp-operations，不是发起调用的数字人。

**为什么是问题**：工具名与文档都说「以本服务身份」，实际不是。Design §8 对工作台内嵌 Swagger 的同一问题给的解法是：试调请求经开发容器里的 TaskRunner 发出，从而以本服务的源 Pod 身份被网关识别。同一个问题在 MCP 这条路上没有对应条款。

**可选做法**：(a) 该工具改为把请求交给 TaskRunner 发出，与 Swagger 试调同一条路径；(b) 网关接受 mcp-operations 代发并按令牌里的服务改写调用方身份；(c) 取消该工具，Agent 直接从开发容器里发请求。

## I2. 业务任务容器的 MCP 连接凭据

**现状**：开发会话启动 Agent 时注入会话级短期令牌；业务子任务（`modules/business-task`）注入的仍是空头。

**为什么是问题**：Design §5.9 的「会话级短期令牌」一句写在开发会话语境里，但 §10 的业务任务容器用的是同一套 MCP 注入形状。业务 Agent 该不该、以什么身份访问平台 MCP，没有条款。

**可选做法**：(a) 业务子任务签发绑定到 businessTask 的等价令牌，授权范围按该服务而不是按用户；(b) 业务容器不连平台 MCP，能力说明经环境变量与 Manifest 给出；(c) 只连能力说明 MCP，不连操作 MCP。

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
