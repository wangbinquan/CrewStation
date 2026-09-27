# RFC-027 实施与验收证据


## 2026-09-27：共同候选门禁与定向修复（第十二批）

RFC027/RFC028 一次共同完整门禁：unit 836 通过；module 1655 通过、9 条按环境跳过、5 条失败；console 925 通过（6385 assertions），分层审计无未执行用例或禁止跳过。static 在10条 lint 处停止，不能声称完整静态检查通过。证据 `/tmp/cs-rfc027-028-final-gate`；执行期间仅基线文档改变，生产/测试冻结。

失败均已归因后定向修复：9处 inline type import 改静态导入，task-runtime wiring 提取原启动日志读取助手；新v3样例补template.json作为可选模板，minimal-sample仍为默认，目录与约定扫描明确覆盖四个独立项目。五个失败文件复验 **12/0（68 assertions）**，含真实materialize v3；日志 `/tmp/rfc027-gate-template-tests.log`。

首次改动行防护 7907/8084=97.81%，但执行宿主选择助手和独立迁移入口未加载，仍阻断。取消/投影改为实际复用既有宿主选择助手；模板真实PG冷启动用例调用与CLI相同的迁移入口并验证重复运行和缺配置。三文件定向 **15/0（136 assertions）**，覆盖 `/tmp/rfc027-gate-behavior-coverage/lcov.info`。纯类型行偏移与助手提取必须重映射覆盖，不能直接叠加旧行号；最终static/patch由同一门禁任务汇总，尚未标通过。

发布范围已由两个任务明确交接给本线程，精确并集 `/tmp/rfc027-028-combined-allowlist.txt`，唯一排除第三方 `tests/e2e/referenceResources.test.ts`。本地main与origin/main最后核对0/0，索引为空。未提交、推送或平台部署，RFC保持In Progress。

最终候选门禁现已通过：全仓 `check:static`、console 生产构建通过；提取助手定向 8/0（53 assertions），driver 重采集 19/0（55 assertions）。以文件 SHA 排除已改变源码的旧覆盖，仅替换为修复后定向覆盖，最终 **7929/8102（97.8647%），473 个生产文件，violations=[]**。证据 `/tmp/cs-rfc027-028-release-patch.json`、`/tmp/cs-rfc027-028-final-static.log`、`/tmp/cs-rfc027-028-console-build.log`。9 条环境跳过为 Prometheus、opt-in registry、真实 K8s/CLI 与 Linux 控制终端；数据库能力为 required，没有数据库跳过。以上闭合本地候选门禁，发布 CI、整平台部署和完整 BE 实机仍待执行。

## 2026-09-27：未知执行恢复、固定 ID 取消屏障与独立测试客户（第十一批）

仍为未提交候选，以下是定向证据，不替代完整门禁、真实集群或真实模型验收。

- 旧 v1/v2 未决票据记录父副作用与原控制面 Pod UID。崩溃请求恢复要求原 UID 已消失、全部远程副作用已确认；超时和缺失记录不会解锁。`/v1/admin/business-execution/legacy-recovery` 提供只读诊断、证据对账及显式停止关联环境；只有管理员可用。恢复保留墓碑，迟到事务不能再插入新任务。工作台 `/admin/business-execution` 展示每项阻塞，并在停止前说明会影响整个关联环境。
- v3 已派发执行在失联时保持 cancelling；独占 Agent 环境可请求停止，共享命令工作区不因一个取消请求而被整体杀掉。平台确认 released 后保留已投影输出，写入 gap 与 `truncated=true` 的 cancelled 结果；不冒称原始输出完整，迟到成功不能覆盖。未启动取消没有原始日志消费义务；消费确认队列公平轮询避免未知流饿死后续项。
- session 为物理停止执行保存独立墓碑，即使 start 回执尚未登记也能阻止迟到注册。部分原始日志保留七天后有界清理，complete 仍为 false，过期读 410；这与 Runner 完整结果消费确认分开。
- task-runtime 新增固定 ID 取消屏障：与项目准入共锁，返回已有环境 released 或未受理 ID 已永久封锁的正面证明。迟到父任务/Agent 创建拒绝且不扣额度。v3 未知准入取消/关闭和旧票据显式停止可使用该证明；普通“查不到”仍不能结束。
- 独立 `templates/business-execution-v3`：无额外工作区包依赖，Dockerfile、Manifest、PG 冷建表、租约控制、应用数据库 epoch 写屏障、90 秒命令、持久 requestKey、事件/文件读取、pause/resume/close 和迁移 drain。真实 PG + 平台替身 3/0（30 assertions），尚未把模板发布到集群；未注册为默认模板，不改变 minimal-sample。
- 取消/投影/session 回收组合 **13/0（120 assertions）**；准入屏障/取消/旧恢复/原业务组合 **25/0（203）**；管理员页面与导航 **7/0（34）**。日志分别 `/tmp/rfc027-cancel-recovery-tests2.log`、`/tmp/rfc027-admission-stop-tests.log`、`/tmp/rfc027-recovery-console-tests2.log`。本批追加 business-task/0026～0027、session/0007、task-runtime/0015 并精确入迁移锁，仅隔离测试库执行。

- 迁移失败恢复补充：资源中心对 Failed migration 保留暂停 Job 名称墓碑；必须观测 Suspended 且实际 Pod 消失后才记录 Stopped，修复发布再读实际墓碑。Job 声明前失败也只补失败停止意图。控制器/恢复/资源阶段定向 **30/0（164 assertions）**。真实集群运行中停止及从未启动两分支核心断言通过，`cs-rfc027-stop-a4706def` 已删除；日志 `/tmp/rfc027-real-migration-stop.log`。日志末尾全局 UID 断言因并行 RFC028 删除其专属 registry 测试 Pod 而非零退出；该任务已确认清理，并提供 `/tmp/cs-rfc028-ledger-probe-cleanup.json` 的原62项 Pod/PVC UID 保持证明。此项仅计迁移核心实机证据，不冒称该脚本整体零退出。

剩余收口：、真实档位能力、隔离测试客户的 BE 集群验收（含真实路由、重启和卷恢复）、浏览器中英文窄屏/键盘、完整候选门禁与改动行防护、精确提交/远端 SHA CI/本地部署。AW T15 和 BE-22～24 仍是外部接入任务，当前仓不修改 AW。

## 2026-09-27：持久交接、迁移排空、发布材料与事件保留（第十批）

本批仍是未提交候选。未向集群部署控制面，未完成 BE-01～21 组合验收、完整候选门禁或精确 SHA CI。以下内容替代历史批次中相应“尚未接通”描述，不将定向用例提升为产品全验收。

- release 已接持久 handoff 操作：同 requestKey、服务单活动操作、数据库 CAS/worker 租约，冻结→准备→路由→激活→完成；路由观测和应用激活均到达后才写完成历史。旧槽、目标变化、维护窗口关闭和应用 epoch/准备摘要变化会阻断继续。工作台显示阶段并从最新操作恢复轮询，受理不会立即显示切流成功。真实 PG 5/0（35 assertions）；console/gateway 14/0（145）。路由证据目前是 K8s IngressRoute 实际 spec，仍需实机请求确认数据面。
- 破坏性迁移在创建 Job 及渲染数据库凭据前双检：持续维护、应用数据库停写回执、无在途派发、所有环境 paused/released，以及实际业务 Pod 已清理。首次全新服务还要求服务 Pod 不存在。`stopAuthority={operationId,epoch}` 仅授予当前正式发布的可信实例取消、暂停和关闭权限，冻结期间不能 resume、新建任务或子任务；有活动子任务时 pause 仍拒绝，先确认取消输出终态。故障恢复保持冻结，较新修复发布只有在旧发布 failed、台账持久 Finished 证明及旧 Pod 清理后才能 CAS 接替原迁移，epoch 增加，继承原应用停写证明；超时、Created=false 和查无记录都不是终止证据。排空/生命周期/取消/恢复组合真实 PG 10/0（102），恢复另组 2/0（29）。旧 owner 模式缺持久 Job 终态时仍保守阻断恢复，尚需补齐完整故障恢复路径。
- 固定 commit SHA 打包 systemPromptFile 和输出 JSON schema；材料不可变登记并复制进父任务契约，大小/路径/缺失校验发生在发布侧。Agent 输出在事件完全 drain 后用发布快照及 cwd 相对安全文件 API 校验。发布与原回归 20/0（190），发布材料/交接/迁移组合 9/0（71）；Linux 输出校验见下项。
- 档位测试分别实测事件、usage、原生 resume、systemPrompt、skills 和 MCP，并绑定固定镜像/修订；普通回显不会授予这些能力。MCP 测试服务必须先从可靠日志确认监听，之后才发 Agent 调用。替身协议测试 3/0（15），真实 CLI/模型能力尚未验证。配置可靠私有日志的 Linux Runner 现在宣告 businessExecutionV3=1；非 Linux 或缺目录仍拒绝。
- session 原日志在业务投影完成且消费回执持久化后保留七天；Runner ACK 本身不能触发回收。清理有界，保留 expired 墓碑，历史读取 410。业务层消费回执丢失通过单独待确认队列跨重启补发，不重复投影结果。session/原投影定向 12/0（106）。
- 父任务后台公平轮询状态，GET 不写日志；创建/运行/关闭状态进入同一事件流，生命周期 generation/CAS 防止旧观测覆盖 pause/close，关闭后不复活历史。事件与消费回执组合真实 PG 8/0（66）。
- 与 RFC028 已获批跨任务协调。新增只读 imageReferenceState：项目/版本/owner 匹配后，只有不可逆父 closed 且相关 Agent runtimeReleased 才给 released；失败准入不明、缺失记录、可 fresh 的终态 Agent 都不能凭 TTL 清理。该接口真实 PG 通过，由 RFC028 接镜像引用对账；不跨模块写表。
- 当前代码在现有原生 arm64 `cs-task-runtime:dev` 镜像内只读挂载验证，容器无网络、tmpfs 临时目录：真实 WS 命令/重启/取消、Agent HOME/事件、可靠消息、输出契约 **8 pass / 0 fail / 56 assertions**，日志 `/tmp/rfc027-linux-protocol-current.log`。容器退出自动清理，不是整平台或真实模型验收。
- 追加且已锁：business-task/0023 发布材料、0024 消费确认、0025 父任务状态观测；release/0008 交接；session/0006 原日志保留。仅隔离测试库执行。已修本任务 23 处 inline import 类型 lint，当前 arch:check 通过，typecheck 待本批末次确认。

下一步仍包括：旧 v2 unknown 票据诊断与有证据恢复、未知/失联执行的终止收敛、迁移失败边界、模板测试客户、真实档位与隔离集群 BE 验收、最终静态/完整门禁/改动行防护、精确提交/远端 CI/部署。AW T15/BE-22～24 保留外部依赖，不修改只读仓库。

## 2026-09-27：旧接口持久屏障与日志丢失保护

- 新增 business-task/0010 迁移并精确入锁。v1/v2 共享 API 写入口与后台 launch 加持久票据；每次外部资源／Runner 调用独立持票，RPC 超时未知不清除。首次 control claim 与旧准入使用同一服务短事务；建立控制后旧写接口拒绝，待派发任务保持 pending，已有执行的只读校验／终态清理继续。旧票据的诊断与有证据恢复尚未接线，不把安全拒绝当作完整可恢复发布。
- `legacyWriteBarrier.test.ts`＋原业务模块定向 **17/0（131 assertions）**：真实 PG 竞争、重建模块仍未知、8 个 v2 写入口、HTTP 已返回的 exec 在途以及 Runner 晚连后的 pending 保持；原模块包含 Agent／命令／取消／输出／关闭行为。前一轮全业务模块 **44/0（351 assertions）**；新屏障用例初次缺事件总线测试迁移失败，补齐隔离库依赖且等后台收尾后通过。
- 日志丢失保护先写回归并观察到原实现删除 executions.sqlite 后静默建空库；随后加入数据库／独立身份双校验，拒绝丢失、清空、替换和有记录但身份缺失。仅未准入初始化可补齐身份。最终日志测试 **9/0（45 assertions）**，含 SIGKILL 后恢复。
- 原生 Linux 的实际 Docker volume-subpath 验证：独立临时卷内初始化父／子 Runner，worker UID 10001 可写 `/work/sentinel`；另一个容器／Agent 读取到原内容；两边读取自己的 `/var/lib/crewstation/business-execution/private` 都返回 EACCES；完整卷根未暴露。临时卷 `cs-rfc027-volume-efa09bf9-1e23-4106-9bf5-bef7385f3cc1` 已由脚本退出清理。此为真实容器挂载证据，仍非 K8s pause/resume／卷 UID 验收。
- 保留环境变量及 NUL 值在业务命令持久准入前拒绝，普通业务变量原样到子进程；该定向 **1/0（21 assertions）**。内部 Runner 参数上限与业务 argv 1024 对齐。JSON 金样未变，语义拒绝另有契约回归。
- 最新 typecheck／arch 与相关定向 ESLint 已通过；先前并行 RFC028 模块解析错误随后消失，未修改其源码。没有重复完整候选门禁、提交、push、CI 或部署。

## 2026-09-27：卷隔离、session 持久接收与文件链路

本段更新以下历史批次中的未接通状态，仍不是完整 BE 或发布验收。

- 业务 v3 准入固定 `isolated-v1` 存储布局，经 task-runtime 台账和 cluster-control 渲染传到 K8s：父任务与 Agent 只共享 work 子目录，各 Runner 私有日志独立挂载；root init 拒绝已有非布局数据、符号链接和丢失的原父目录。布局本机测试 9/0，台账真实 PG 8/0（68 assertions）；尚无实际集群挂载／暂停恢复证据。
- session 登记执行接收意图后才发 start；每流短事务持久去重事件，连续水位闭合后 ACK Runner。完成事件提前到达不能结束缺少输出的流；ACK 回执丢失后从 PG 水位恢复。内部持久查询与 session-client 已接通，worker 只轮询已连接且声明能力的 Runner。新增接收／worker／客户端测试 12/0（78 assertions）。session/0005 迁移已入锁，仅执行在隔离测试库。
- 文件 API 已从 v3 服务路由接到 Runner，严格验证任务归属；暂停返回 409 `task_paused`，离线／关闭中不创建资源。保留 `file_version_changed` 409、路径拒绝 403、缺失 404 等错误。`CS_TEST_REQUIRE=database bun test modules/business-task/tests/executionFiles.test.ts modules/business-task/tests/executionHttp.test.ts`：8/0（93 assertions）。
- 分块读取以 64 KiB 缓冲扫描内容摘要，仅保存最多 1 MiB 请求内容；目录保留有界候选页，游标绑定路径及目录版本。Linux 使用 openat2/O_PATH 固定描述符，再校验类型与管理目录。原生 arm64 容器运行 `businessFiles.test.ts` 和 `businessExecutionProtocol.test.ts`：7/0（110 assertions）；含超过 2 MiB 文件的分块还原、真实 WS 的 1 MiB 二进制块、版本冲突、内部链接、越界／保留目录／FIFO 拒绝和 40 轮并发链接替换。容器无网络、代码只读、临时目录 tmpfs，没有更新共享服务。
- 首次 amd64 仿真镜像返回 errno 38（openat2 ENOSYS），该轮 1/3 不算通过。改用本机已有 `cs-task-runtime:replies-20260923` 原生 arm64 镜像加载当前只读代码后通过；产品对不支持平台／内核返回明确 unsupported_capability，不退回不安全打开。
- 本批文件接线首次 typecheck／arch／定向 lint 通过；末次 typecheck 被并行 RFC028 的 `@crewstation/module-runtime-environment` 尚不可解析及其接线 tx 隐式 any 阻断，未改其输出，不声称当前共享树完整门禁通过。

完整 businessExecutionV3 仍不宣告。旧 API 在途屏障、业务子任务派发、生命周期、材料／会话、事件对外投影／保留和 release 交接等继续实施。尚未完整候选门禁、提交、push、精确 SHA CI 或本地部署。

## 2026-09-27：Runner 可靠命令基础与协议接线

新增 `runtimes/task/src/exec` 私有 SQLite 执行日志（WAL／FULL）、异步监督器和业务命令处理器。先持久准入再 spawn，同 ID／摘要只返回原回执；跨 incarnation 的未完成记录为 unknown，不按旧 PID 重启。输出、状态和完成水位在本地事务内追加；session 的连续确认才允许回收事件，执行墓碑与结果不回收。取消等到进程退出观测，日志触顶终止执行并留下明确失败；日志本身不可写时不伪造成功。

新增 Runner 内部 info/start/get/cancel/read/ack 六类严格命令，已接入真实 Runner WS dispatcher；session 在写 socket 前检查 businessExecutionV3，旧 exec 保持原接口。目前通过显式 `CS_RUNNER_BUSINESS_JOURNAL_DIR` 配置启用局部执行器，**完整 businessExecutionV3 仍不宣告，生产 Pod 未配置该目录**。持久卷中 worker 路径与 Runner 私有路径的隔离布局、session PG 日志与投影、业务任务派发尚未接通；不能据此宣布 BE-04～08 的平台／集群范围完成。

证据：

- 新日志／监督器／WS 协议／能力协商与原 Runner 生命周期、协议回归合计 **34 pass / 0 fail，201 assertions**。使用临时目录、真实子进程、随机本机 WS 端口；端口测试先在沙箱失败，授权本机监听后执行通过。
- 单独的 **90 秒真实命令测试 1 pass / 0 fail，5 assertions，90.21 秒**：立即返回 running，原 30 秒期限不决定结果，最终退出码 0，START/END 完整；没有用缩短时钟替代。
- 追加真实存储失效用例 **1 pass**：运行中关闭日志连接，输出持久化失败后停止进程；新 incarnation 只能查询 unknown，不能重新准入。
- 补读页同时受 1 MiB 总量和条数限制。新增多页用例发现提前结束 SQLite 遍历使缓存 statement 不能复用，改成独立 prepared statement 并 finalize；最终日志组 **7 pass / 0 fail，38 assertions**，含真进程 SIGKILL 后恢复。
- 原 session 命令派发与契约金样 **14 pass / 0 fail，49 assertions**；内部 Runner 命令新增不改变外部业务金样。
- 定向 ESLint、diff 检查通过。中途 typecheck／arch 曾观察到并行 RFC028 的 SCM `listTree` 未接线及 `sourceTree.ts` 跨层依赖，未改动它们。并行代码推进后本批最终 `bun run typecheck` 与 `bun run arch:check` 均通过；仍未执行完整门禁和改动行覆盖。最终 fetch 后 main 与 origin/main 相同（0/0）。

仍未提交、推送、部署或执行整项集群 BE 验收。优先继续受保护持久卷布局、session 可靠落库与业务异步派发，再落实 v1/v2 在途屏障和 release 交接。此前全部未完成项保持原范围。

## 2026-09-27：父任务 HTTP、执行权事务与后台恢复

本段取代下段对应项中的“尚未接通”状态，仍是未提交候选，不是产品验收或部署证据。

- v3 父任务 POST/GET 与控制 read/claim/renew/release/activate/handoff-ready 已装配，platform 通过 identity 验签端口解析当前源 Pod。未知字段明确 400，签名身份不匹配 403，来源 release 未登记 412，参数变化 409，容量拒绝 429＋Retry-After；不重读 latest。
- 同一服务的控制变更与新意图受理共用短事务协调。使用 DB 时钟、实例／Pod 绑定、preparing 回执、续租 CAS 和递增 epoch。冻结与新受理的真实 PG 并发用例证明：要么意图先入库再冻结，要么拒绝；冻结后旧 epoch 不能获得派发票据。
- 派发票据是持久操作租约。交接等待未知在途操作对账；控制器 worker 重启仍用原 ID 恢复；正常 pending 不因旧 epoch 自动派发，需新 holder 显式同键接管。429 不进入容量等待队列。GET 只读不启动任务。
- 接管准备／路由确认／激活的业务控制侧已实现，重复同 operationId 的来源／目标必须相同，完成后的准备回执可重放。**尚未接入 release 发布和回退流程**，不能据此声称蓝绿交接已完成。
- 新增 `business-task/0009_execution_control.sql` 精确入锁，仅在测试库迁移。
- 资源观测未知采用 `quotaHeld: null`；v3 尚未发布，该候选修订依据在 design §3 与契约金样中留痕。v2 响应未改变。SDK 显式 trace 同时发送 body/header，避免网关另生 trace 导致冲突。

验证：

- `CS_TEST_REQUIRE=database bun test modules/business-task/tests`：**41 pass / 0 fail，303 assertions**；包括原 v2、HTTP、操作日志、控制与真实并发冻结。
- 最后修改交接重复回执和来源版本匹配后，`CS_TEST_REQUIRE=database bun test modules/business-task/tests/executionControl.test.ts`：**6 pass / 0 fail，67 assertions**。
- `bun test packages/api-client`：**38 pass / 0 fail，426 assertions**。
- `bun test modules/business-task/workers/executionWorker.test.ts packages/contracts/tests/surfaceLock.test.ts packages/contracts/api/business/execution.test.ts`：**15 pass / 0 fail，50 assertions**。worker 不重叠运行，关闭等待在途一轮。
- 本批定向 ESLint、`git diff --check` 通过。全库 typecheck/arch 当前**未通过**：观察到并行 RFC028 的 `runtime-environment/domain/contentDigest.ts` 引用不存在的 `sha256`、测试未完成依赖和 runtime-environment 新迁移未入锁；保留并发内容，没有修复或绕过门禁。最终发布仍须整个候选的正式门禁通过。

必须继续处理：fenced 服务不能通过 v1/v2 写接口绕过屏障，且切换前在途旧请求必须纳入协调；子任务、Runner 能力与日志、事件、材料、文件、暂停／恢复、会话、release 流程和集群验收均未完成。控制侧当前将全部已准入父操作用于兼容检查，任务终态投影落地后须按 RFC 只检查未结束任务。没有任何完整 BE 项据本段关闭。

## 2026-09-27：基础层，尚未产品验收

本批基线 `01ecfc1f20b1588341b351216ad7cc029042b05d`。以下为未提交候选的定向结果；不能据此宣称 RFC 完成、v3 已可用、集群已部署或 aw 已接入。作者已批准完整 CS 实现、远端提交及本地部署，aw 是外部只读仓库。

| 范围 | 当前实现 | 已验证 | 尚缺 |
|---|---|---|---|
| T3 | 严格 v3 请求／响应、材料／事件／文件／控制 DTO、客户端；Manifest 配置与探针 | 契约及客户端定向测试，金样为纯新增 | 服务端路由、能力与错误响应、Runner 新帧 |
| T4 | task-runtime 固定 ID 幂等准入；business-task 操作日志与租约 CAS、父任务派发／对账用例；trace/defaults 构造 | PG 并发只扣一次额度，套餐删除仍重放；429 不自动排队；意图和资源 ID 不漂移；过期 worker 写回拒绝 | HTTP、同事务执行权屏障、后台装配、Agent/command 与其他操作 |
| T9 | 完整 release 任务声明保存，按 service/release 精确读取，重复事件不覆盖／不移动 latest 顺序 | 同 release 不同内容冲突；旧行只补齐一次；使用固定默认值 | 发布文件材料、fresh/resume、会话租约 |
| T10 | 控制器观测投影 source，ForwardAuth 签名来源绑定，identity API 验签并现查 Pod | 同名替换的旧删除事件不撤销新 Pod；缺证据旧 Pod 无 v3 来源；错误受众／伪造令牌／UID、IP、release、槽、服务变化拒绝 | business-task HTTP 接线、epoch/holder、事务屏障、发布交接 |
| T12 | 独立探针贯通 Manifest → release → 台账 → K8s；旧参数兼容 | 新探针保留；无效台账探针拒绝；旧形状不变 | 平台发布链集成／集群慢启动、v3 模板客户 |

具体运行：

- `CS_TEST_REQUIRE=database bun test modules/business-task/tests modules/task-runtime/tests/ledgerCreation.test.ts`：**37 pass / 0 fail，252 assertions**。真实 PostgreSQL 隔离测试库；包括原有 v2 模块／路由回归。
- `CS_TEST_REQUIRE=database bun test modules/gateway/tests/gatewayModule.test.ts modules/identity/tests/forwardAuth.test.ts`：**28 pass / 0 fail，177 assertions**。真实签名与 PG 身份索引；未触碰共享业务 Pod。
- `bun test packages/contracts/tests packages/contracts/api/business packages/contracts/manifest/businessExecution.test.ts packages/api-client/businessApiClient.test.ts packages/k8s/objects/slot.test.ts modules/cluster-control/domain/slotRender.test.ts`：**56 pass / 0 fail，209 assertions**。
- `bun run typecheck`、本批定向 ESLint、`bun run arch:check`、`git diff --check` 通过。尚未执行完整本地门禁与改动行防护；未提交、推送、运行候选 CI 或部署。
- 精确迁移锁新增 task-runtime `0012_business_admission.sql`、business-task `0007_execution_operations.sql` 与 `0008_release_tasks_spec.sql`、gateway `0007_service_source.sql`。只在一次性测试库执行，未应用部署库。
- 契约金样累计新增 v3 面／Manifest 可选项与四个来源 token claim；本批生成报告无破坏性变化。

关键恢复约束：发生过未知准入的操作，即使下一 worker 读不到资源且收到 429，仍保存原 ID 并继续对账。原因是旧 worker 的调用可能在途，不能据一次不存在查询证明永远没有资源。确认的容量拒绝才允许 `retryable-rejected`，该状态不会被后台 claim；用户同键重试才重新准入。

BE-01～21 尚需各自完整范围的证明。BE-22～24 的真实 aw 接入由外部任务负责，CS 的通用测试客户验收仍全部在本 RFC 内。不得把本表的基础层测试计作完整 BE 通过。

## 2026-09-27 第六批：命令受理与业务事件投影

- v3 command 固定 ID、并发幂等、平台密钥加密材料、epoch 二次检查、派发 incarnation 检查点、模块重建恢复和旧 Runner 受理前拒绝已接线。GET 不派发，不明结果不自动换 ID。冻结同时等待在途／unknown 子任务。新增 business-task/0011、0012 迁移并精确入锁。
- business-task 经 session 公开端口读持久事件，事务内保存连续来源水位、事件和状态；终态等最终事件闭合，迟到派发回执不能覆盖终态。分页游标绑定任务与筛选，SSE 支持 Last-Event-ID；关闭 SSE 不取消执行。摘要同时限制 UTF-8 和 JSON 编码字节，完整输出另存事件。
- 受理／投影／session PG 定向合计 15 pass / 0 fail，134 assertions；摘要／退出语义单元测试 2 pass / 0 fail，22 assertions。投影首次测试发现 Drizzle 的 schema-qualified FOR UPDATE OF 语法错误，改用别名后通过。架构与定向 lint 通过；最后一次全仓 typecheck 被并行 RFC028 的 validation/controller.ts 三处类型错误阻断，未修改该文件。
- 仍未完成取消／retry／pause-resume-close、Agent 材料／usage／会话、历史过期、release 完整交接与产品 UI；不宣告完整 Runner 能力、不等同 BE 集群验收。未提交、推送或部署。

## 2026-09-27 第七批：取消、命令 fresh 重试和 pending 接管

- command cancel 先写独立幂等操作和 cancelRequestedAt。未进入派发的原子撤销会失效旧派发票据并生成终态事件；在途取消保持 cancelling，真实输出闭合后才完成。Runner 支持原身份取消墓碑，防止取消先到后迟到 start 启动副作用；session 在发送这种取消前登记可靠接收。
- command fresh retry 在独立 operation scope 生成新 subtaskId／executionId 和递增 attempt；原状态、输出及幂等回执不变，同一原 attempt 只准一个后继。非终态／未知执行／command resume 拒绝。新 holder 可用原 requestKey 显式接管未派发 pending 的 epoch。
- 取消＋session 初步 PG 6/0（54 assertions）；真实 WS＋session 8/0（50 assertions）；取消墓碑真实进程定向 1/0（6 assertions）。命令受理／重试／取消／投影合并 15/0（148 assertions）；追加 pending 接管测试最初错误使用全局 worker 计数，修正为目标 epoch 和启动次数后受理组 6/0（54 assertions）。之前完整业务模块＋session 定向回归为 68/0（556 assertions）。
- 0013、0014 精确入 migration lock。全仓 typecheck 已随后通过，架构通过；一处新增 lint 的 inline import 类型已修正。contracts:lock 运行遇到并行 RFC028 Manifest v2/v3 变化需其批准依据，未强制更新或改写其 golden。
- 尚无完整候选门禁、提交、推送或部署。父生命周期与卷 UID 恢复、Agent、历史保留／410、旧票据恢复、release、产品界面和隔离集群验收仍待完成。


## 2026-09-27 第八批：父生命周期与历史过期

- v3 pause/resume/close 在服务事务中固定操作 ID、generation 与执行权，并与子任务准入互斥；活动或未知子任务先取消并确认才允许暂停／关闭。原 ID 对账、租约 CAS、429 显式同键重试与查询无副作用已验证。
- task-runtime 记录原 PVC UID，恢复和渲染均拒绝卷替换、缺失、删除中或归属不符。暂停／关闭等原 Pod 实际消失后才释放额度；修复台账已进入 absent 后所属模块条件不更新导致额度不释放，并让隔离业务任务的台账投影失败回滚本次状态事务。
- 任务状态与事件同事务保存。游标包含日志世代；确认 closed 后七天进入有界回收（每轮最多 1000 条），保留水位与墓碑；过期查询及 SSE 握手返回 410／earliestCursor／snapshotUrl。未确认关闭的任务不按事件年龄清理。session 原始日志保留清理尚待实现。
- PG 工作区 4 pass / 0 fail（34 assertions）；生命周期／保留／命令投影／取消 13 pass / 0 fail（137 assertions）。架构与定向 lint 通过。类型检查首次发现新增 gone 未加 Runner 错误映射，已补，待复验。migration lock 新增 business-task/0015、0016 与 task-runtime/0014；只执行隔离测试库。
- 未执行全候选门禁、完整 BE 集群验收、commit、push 或部署。Agent、会话、旧票据恢复、release、UI 和模板继续实施。


## 2026-09-27 第九批：独立 Agent、会话与能力准入

- Agent 使用固定 runtimeTaskId 的独立环境、加密启动计划和随机 nonce 摘要，固定父发布／档位修订／provider 凭据版本／项目 Secret 版本。准入回执丢失只查原资源；429 不进入容量等待队列；取消在原资源清理后收敛。凭据 clear 会撤销历史快照，重新设置不复活旧版本。
- Runner 的原生会话 HOME 与 XDG 目录挂到父 PVC 的独立 session key；平台按物理目录而非 session 别名独占写。终态不等于已释放，必须得到原 Pod 清理证明；资源记录缺失保持占用。resume 不重新解析默认档位，拒绝跨任务、卷 UID 改变、cwd／材料／模式改变；fresh 另建目录并允许重新解析档位。交互消息先落两端日志，失去回执只查询原 messageId。
- skills 在全新私有临时目录写完后才移交 worker，Claude 经独立插件目录、OpenCode 经 skills.paths 引用；平台或工作区同名拒绝，结束清理。已知凭据在公开事件入日志前遮盖，包括跨文本帧、工具载荷和错误。没有把原生 CLI 内部委派当成逐 Agent 计额。
- 能力 HTTP 返回发布绑定档案、固定修订及平台限制。只有该修订成功测试中的业务能力证据允许 v3 Agent 准入；普通模型测试通过不等于业务能力可用。真实档位测试的完整业务 probe 尚待补齐，Runner hello 仍未宣告全功能 v3，不能以测试替身证明真实 CLI 支持。
- 定向证据：Agent／能力／会话／RFC028 镜像回归 12 pass / 0 fail（110 assertions）；fresh/resume 与命令重试 6/0（59）；档位／凭据版本／能力记录 16/0（102）；skills 与已有托管配置 11/0（40）；真实 WS、消息幂等和凭据遮盖 3/0（23）。最新 typecheck 与 arch:check 通过。迁移0022已入锁；全部数据库改动只执行隔离测试库。
- 尚未全候选门禁、完整 BE 集群验收、commit、push 或部署。发布材料、输出契约、会话原始日志回收、旧票据恢复、release 交接与维护迁移、产品界面、模板和真实档位证据继续实现。business-task 反向交接端口新实现仍待集成验证。
